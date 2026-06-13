"""HTTP routes for the Request-Release flow (Phase 3)."""

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user
from app.modules.models import User
from app.modules.release.service import (
    ReleaseService, ReleaseCreate, ReleaseRequestOut, ReleaseAccept,
)

router = APIRouter(prefix="/release-requests", tags=["release-requests"])


@router.post("", response_model=ReleaseRequestOut, status_code=201)
def create_request(data: ReleaseCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return ReleaseService(db).create_request(data, current_user)


@router.get("/incoming", response_model=List[ReleaseRequestOut])
def incoming(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Requests where I am the holder (someone wants my slot)."""
    return ReleaseService(db).list_incoming(current_user)


@router.get("/outgoing", response_model=List[ReleaseRequestOut])
def outgoing(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Requests I have sent."""
    return ReleaseService(db).list_outgoing(current_user)


@router.post("/{request_id}/accept", response_model=ReleaseRequestOut)
def accept(request_id: str, data: Optional[ReleaseAccept] = None,
           db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = data or ReleaseAccept()
    return ReleaseService(db).accept(request_id, current_user,
                                     mode=data.mode, new_start=data.new_start, new_end=data.new_end)


@router.post("/{request_id}/decline", response_model=ReleaseRequestOut)
def decline(request_id: str, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user)):
    return ReleaseService(db).decline(request_id, current_user)


@router.post("/{request_id}/cancel", response_model=ReleaseRequestOut)
def cancel(request_id: str, db: Session = Depends(get_db),
           current_user: User = Depends(get_current_user)):
    return ReleaseService(db).cancel(request_id, current_user)
