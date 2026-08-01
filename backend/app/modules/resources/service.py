from typing import Optional, List
from fastapi import HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.modules.models import Resource, ResourceType, AuditLog, User
from app.core.events import bus
import json


class ResourceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    resource_type: ResourceType
    location: Optional[str] = None
    capacity: Optional[int] = None
    requires_approval: bool = False


class ResourceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    capacity: Optional[int] = None
    requires_approval: Optional[bool] = None
    is_active: Optional[bool] = None


class ResourceOut(BaseModel):
    id: str
    name: str
    description: Optional[str]
    resource_type: str
    location: Optional[str]
    capacity: Optional[int]
    requires_approval: bool
    is_active: bool

    class Config:
        from_attributes = True


class ResourceService:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _validate_capacity(capacity):
        if capacity is not None and capacity < 0:
            raise HTTPException(status_code=400, detail="Capacity can't be negative")

    def create(self, data: ResourceCreate, actor: User) -> Resource:
        payload = data.model_dump()
        name = (payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        payload["name"] = name
        self._validate_capacity(payload.get("capacity"))
        resource = Resource(**payload)
        self.db.add(resource)
        self.db.flush()
        self._audit(actor, "resource.created", "Resource", resource.id, None, data.model_dump())
        self.db.commit()
        self.db.refresh(resource)
        bus.publish("resource.created", {"resource_id": resource.id, "actor_id": actor.id})
        return resource

    def list_all(self, resource_type: Optional[ResourceType] = None, active_only: bool = True) -> List[Resource]:
        q = self.db.query(Resource)
        if active_only:
            q = q.filter(Resource.is_active == True)
        if resource_type:
            q = q.filter(Resource.resource_type == resource_type)
        return q.order_by(Resource.name).all()

    def get(self, resource_id: str) -> Resource:
        r = self.db.query(Resource).filter(Resource.id == resource_id).first()
        if not r:
            raise HTTPException(status_code=404, detail="Resource not found")
        return r

    def update(self, resource_id: str, data: ResourceUpdate, actor: User) -> Resource:
        r = self.get(resource_id)
        # exclude_UNSET (not exclude_none): only fields the client actually sent are
        # applied — but an explicitly-null field IS included, so an admin CAN clear an
        # optional field (capacity/location/description) back to empty. exclude_none made
        # that impossible: null was dropped, so a set capacity could never be removed.
        changes = data.model_dump(exclude_unset=True)
        if "name" in changes:
            nm = (changes["name"] or "").strip()
            if not nm:
                raise HTTPException(status_code=400, detail="Name can't be blank")
            changes["name"] = nm
        self._validate_capacity(changes.get("capacity"))
        old = {k: getattr(r, k) for k in changes}
        for field, value in changes.items():
            setattr(r, field, value)
        self._audit(actor, "resource.updated", "Resource", resource_id, old, changes)
        self.db.commit()
        self.db.refresh(r)
        return r

    def delete(self, resource_id: str, actor: User):
        r = self.get(resource_id)
        r.is_active = False
        self._audit(actor, "resource.deactivated", "Resource", resource_id, None, None)
        self.db.commit()

    def _audit(self, actor: User, action: str, entity_type: str, entity_id: str, old, new):
        log = AuditLog(
            actor_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_values=json.dumps(old) if old else None,
            new_values=json.dumps(new) if new else None,
        )
        self.db.add(log)
