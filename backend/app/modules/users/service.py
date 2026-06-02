from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.modules.models import User, UserRole, Notification
from app.core.security import get_password_hash


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class NotificationOut(BaseModel):
    id: str
    notification_type: str
    title: str
    message: str
    is_read: bool
    created_at: str

    class Config:
        from_attributes = True


class UserService:
    def __init__(self, db: Session):
        self.db = db

    def list_users(self) -> List[User]:
        return self.db.query(User).order_by(User.full_name).all()

    def get_user(self, user_id: str) -> User:
        u = self.db.query(User).filter(User.id == user_id).first()
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return u

    def update_user(self, user_id: str, data: UserUpdate, actor: User) -> User:
        u = self.get_user(user_id)
        for field, value in data.model_dump(exclude_none=True).items():
            setattr(u, field, value)
        self.db.commit()
        self.db.refresh(u)
        return u

    def get_notifications(self, user_id: str, unread_only: bool = False) -> List[Notification]:
        q = self.db.query(Notification).filter(Notification.recipient_id == user_id)
        if unread_only:
            q = q.filter(Notification.is_read == False)
        return q.order_by(Notification.created_at.desc()).limit(50).all()

    def mark_notifications_read(self, user_id: str):
        self.db.query(Notification).filter(
            Notification.recipient_id == user_id,
            Notification.is_read == False
        ).update({"is_read": True})
        self.db.commit()
