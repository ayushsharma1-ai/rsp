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


class ClashPreviewRequest(BaseModel):
    start_time: datetime
    end_time: datetime
    group_ids: List[str] = []
    resource_ids: List[str] = []


@router.post("/preview", response_model=List[ClashInfo])
def preview_clashes(data: ClashPreviewRequest, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    """Check clashes for a *proposed* event (used by the create form before saving)."""
    return ClashService(db).find_clashes(
        data.start_time, data.end_time, data.group_ids, data.resource_ids,
    )


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
    return clashes
