from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.modules.models import User, UserRole, Notification
from app.core.security import get_password_hash
from app.core.config import settings


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


class MemberCreate(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole = UserRole.PROFESSOR


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

    def create_member(self, data: 'MemberCreate') -> User:
        """Admin-only: add a department member. Enforces the allowed email domain,
        uniqueness, and a minimum password length. (There is no public self-signup.)"""
        email = data.email.strip().lower()
        domain = "@" + settings.ALLOWED_EMAIL_DOMAIN.strip().lower()
        if not email.endswith(domain):
            raise HTTPException(status_code=400, detail=f"Email must be a {domain} address")
        if not data.full_name.strip():
            raise HTTPException(status_code=400, detail="Full name is required")
        if len(data.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        if self.db.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=409, detail="A user with this email already exists")
        user = User(
            email=email,
            full_name=data.full_name.strip(),
            hashed_password=get_password_hash(data.password),
            role=data.role,
            is_active=True,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

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

    def set_notification_read(self, user_id: str, notif_id: str, is_read: bool) -> Notification:
        """Mark a SINGLE notification read/unread. Scoped to the owner so one user
        can't toggle another's notifications."""
        n = self.db.query(Notification).filter(
            Notification.id == notif_id,
            Notification.recipient_id == user_id,
        ).first()
        if not n:
            raise HTTPException(status_code=404, detail="Notification not found")
        n.is_read = is_read
        self.db.commit()
        self.db.refresh(n)
        return n
