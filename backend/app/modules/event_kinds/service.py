"""
Event kinds (types) — Class / Workshop / Talk / … each with a display colour.

Read by anyone (the create-event form needs the list); created/edited by ADMINS
only (enforced in the route layer). Regular users never add kinds.
"""

from typing import List, Optional
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.modules.models import EventKind, Event


class EventKindOut(BaseModel):
    id: str
    name: str
    color: str

    class Config:
        from_attributes = True


class EventKindCreate(BaseModel):
    name: str
    color: str          # hex like "#4f46e5"


class EventKindUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class EventKindService:
    def __init__(self, db: Session):
        self.db = db

    def list_kinds(self) -> List[EventKind]:
        return self.db.query(EventKind).order_by(EventKind.name).all()

    def create_kind(self, data: EventKindCreate) -> EventKind:
        name = (data.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        if self.db.query(EventKind).filter(EventKind.name == name).first():
            raise HTTPException(status_code=409, detail=f"Event kind '{name}' already exists")
        kind = EventKind(name=name, color=(data.color or "").strip() or "#475569")
        self.db.add(kind)
        self.db.commit()
        self.db.refresh(kind)
        return kind

    def update_kind(self, kind_id: str, data: EventKindUpdate) -> EventKind:
        kind = self.db.query(EventKind).filter(EventKind.id == kind_id).first()
        if not kind:
            raise HTTPException(status_code=404, detail="Event kind not found")
        if data.name is not None:
            new_name = data.name.strip()
            if new_name and new_name != kind.name:
                # Renaming onto another kind's name violates the UNIQUE constraint,
                # which would surface as a raw 500 at commit. Check first (mirror create).
                clash = self.db.query(EventKind).filter(
                    EventKind.name == new_name,
                    EventKind.id != kind_id,
                ).first()
                if clash:
                    raise HTTPException(status_code=409,
                                        detail=f"Event kind '{new_name}' already exists")
                kind.name = new_name
        if data.color is not None:
            kind.color = data.color.strip() or kind.color
        self.db.commit()
        self.db.refresh(kind)
        return kind

    def delete_kind(self, kind_id: str) -> None:
        kind = self.db.query(EventKind).filter(EventKind.id == kind_id).first()
        if not kind:
            raise HTTPException(status_code=404, detail="Event kind not found")
        # Refuse if any event still uses this kind — deleting it would strip those
        # events' type/colour. The admin must reassign or remove those events first.
        in_use = self.db.query(Event).filter(Event.event_kind_id == kind_id).first()
        if in_use:
            raise HTTPException(
                status_code=409,
                detail="This kind is still used by one or more events. Change those "
                       "events' kind first, then delete it.",
            )
        self.db.delete(kind)
        self.db.commit()
