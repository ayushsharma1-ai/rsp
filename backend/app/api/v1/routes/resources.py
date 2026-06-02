from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user, require_admin
from app.modules.models import User, ResourceType
from app.modules.resources.service import ResourceService, ResourceCreate, ResourceUpdate, ResourceOut

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("", response_model=List[ResourceOut])
def list_resources(
    resource_type: Optional[ResourceType] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return ResourceService(db).list_all(resource_type=resource_type, active_only=active_only)


@router.get("/{resource_id}", response_model=ResourceOut)
def get_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return ResourceService(db).get(resource_id)


@router.post("", response_model=ResourceOut)
def create_resource(
    data: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return ResourceService(db).create(data, current_user)


@router.patch("/{resource_id}", response_model=ResourceOut)
def update_resource(
    resource_id: str,
    data: ResourceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return ResourceService(db).update(resource_id, data, current_user)


@router.delete("/{resource_id}", status_code=204)
def delete_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    ResourceService(db).delete(resource_id, current_user)
