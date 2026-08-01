"""HTTP routes for clash detection (Phase 2)."""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user
from app.modules.models import User, UserRole, Event
from app.modules.clash.service import ClashService, ClashInfo

router = APIRouter(prefix="/clashes", tags=["clashes"])


def _mask_private(clashes: List[ClashInfo], db: Session, user: User) -> List[ClashInfo]:
    """Hide the TITLE of events the caller isn't allowed to read.

    The clash itself must still be reported — the room genuinely is busy, and the
    slot-request flow needs the booking + holder to address a request to. But the
    title is the private part: without this, anyone (including a view-only VIEWER)
    could sweep a room across a day and harvest the titles of every private event
    in it, which GET /events/{id} and the calendar feed both refuse to show them.
    Same rule as get_event_detail: admin, or public, or your own.
    """
    if user.role == UserRole.ADMIN:
        return clashes
    ids = {c.event_id for c in clashes}
    if not ids:
        return clashes
    visible = {
        e.id for e in db.query(Event).filter(Event.id.in_(ids)).all()
        if e.is_public or e.organizer_id == user.id
    }
    for c in clashes:
        if c.event_id not in visible:
            c.title = "Busy"
    return clashes


class ClashPreviewRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    group_ids: List[str] = []
    resource_ids: List[str] = []


@router.post("/preview", response_model=List[ClashInfo])
def preview_clashes(data: ClashPreviewRequest, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Check clashes for a *proposed* event (used by the create form before saving)."""
    clashes = ClashService(db).find_clashes(
        data.start_time, data.end_time, data.group_ids, data.resource_ids,
    )
    return _mask_private(clashes, db, current_user)


@router.get("/event/{event_id}", response_model=List[ClashInfo])
def event_clashes(event_id: str,
                  start: Optional[datetime] = Query(None),
                  end: Optional[datetime] = Query(None),
                  db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    """Clashes for an event. Pass start/end to preview at a NEW time (used when editing).
    Student-clash detail is host-only (privacy rule E)."""
    ev = db.query(Event).filter(Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    clashes = ClashService(db).clashes_for_event(event_id, start, end)

    is_host = (ev.organizer_id == current_user.id) or (current_user.role == UserRole.ADMIN)
    if not is_host:
        # hide student-clash info from non-hosts; venue clashes stay visible
        for c in clashes:
            c.student_clash = False
            c.shared_student_count = 0
    return _mask_private(clashes, db, current_user)
