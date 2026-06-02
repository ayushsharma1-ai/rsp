from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user, require_admin
from app.modules.models import User
from app.modules.users.service import UserService, UserOut, UserUpdate, NotificationOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return UserService(db).list_users()


@router.get("/me/notifications")
def my_notifications(
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notifs = UserService(db).get_notifications(current_user.id, unread_only)
    return [
        {
            "id": n.id,
            "type": n.notification_type.value,
            "title": n.title,
            "message": n.message,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
            "booking_id": n.related_booking_id,
        }
        for n in notifs
    ]


@router.post("/me/notifications/read", status_code=204)
def mark_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    UserService(db).mark_notifications_read(current_user.id)


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return UserService(db).get_user(user_id)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: str,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return UserService(db).update_user(user_id, data, current_user)
