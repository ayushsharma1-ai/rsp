"""HTTP routes for event kinds (event types + their colours).

GET   /event-kinds        — list (any logged-in user; the create form needs it)
POST  /event-kinds        — ADMIN only (add a new kind, e.g. via Postman)
PATCH /event-kinds/{id}   — ADMIN only (rename / recolour)

Regular logged-in users CANNOT create kinds — only pick from existing ones.
"""

from typing import List

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user, require_admin
from app.modules.models import User
from app.modules.event_kinds.service import (
    EventKindService, EventKindOut, EventKindCreate, EventKindUpdate,
)

router = APIRouter(prefix="/event-kinds", tags=["event-kinds"])


@router.get("", response_model=List[EventKindOut])
def list_kinds(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return EventKindService(db).list_kinds()


@router.post("", response_model=EventKindOut, status_code=201)
def create_kind(data: EventKindCreate, db: Session = Depends(get_db),
                current_user: User = Depends(require_admin)):
    return EventKindService(db).create_kind(data)


@router.patch("/{kind_id}", response_model=EventKindOut)
def update_kind(kind_id: str, data: EventKindUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_admin)):
    return EventKindService(db).update_kind(kind_id, data)


@router.delete("/{kind_id}", status_code=204)
def delete_kind(kind_id: str, db: Session = Depends(get_db),
                current_user: User = Depends(require_admin)):
    # Hard-delete an UNUSED kind (409 if any event still references it). Lets an admin
    # remove a typo'd/obsolete kind without it lingering forever in the create picker.
    EventKindService(db).delete_kind(kind_id)
    return Response(status_code=204)
