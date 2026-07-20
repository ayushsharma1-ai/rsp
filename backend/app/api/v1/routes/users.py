from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user, require_admin
from app.modules.models import User
from app.modules.users.service import (
    UserService, UserOut, UserUpdate, NotificationOut, MemberCreate,
    PasswordChange, PasswordReset,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=List[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return UserService(db).list_users()


@router.post("", response_model=UserOut, status_code=201)
def create_member(
    data: MemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),   # only an admin can add members
):
    return UserService(db).create_member(data)


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
            "event_id": n.related_event_id,
        }
        for n in notifs
    ]


@router.post("/me/notifications/read", status_code=204)
def mark_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    UserService(db).mark_notifications_read(current_user.id)


@router.post("/me/notifications/{notif_id}/read", status_code=204)
def mark_one_read(
    notif_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    UserService(db).set_notification_read(current_user.id, notif_id, True)


@router.post("/me/notifications/{notif_id}/unread", status_code=204)
def mark_one_unread(
    notif_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    UserService(db).set_notification_read(current_user.id, notif_id, False)


# NOTE: declared BEFORE the "/{user_id}" routes so "me" isn't swallowed as a user id.
# Uses get_current_user (not require_editor) — even a view-only member must be able
# to change their own password.
@router.post("/me/password", status_code=204)
def change_my_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    UserService(db).change_own_password(current_user, data)


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


@router.post("/{user_id}/password", status_code=204)
def reset_user_password(
    user_id: str,
    data: PasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),   # admin resets a forgotten password
):
    UserService(db).admin_reset_password(user_id, data.new_password)
