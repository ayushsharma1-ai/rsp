from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.modules.models import User, UserRole, Notification
from app.core.security import get_password_hash, verify_password
from app.core.config import settings

# Minimum length for any password we set (new member, self-change, or admin reset).
MIN_PASSWORD_LEN = 8


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


class PasswordChange(BaseModel):
    """A member changing their OWN password — must prove they know the current one."""
    current_password: str
    new_password: str


class PasswordReset(BaseModel):
    """An admin setting a new password for someone (e.g. they forgot theirs)."""
    new_password: str


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
        if len(data.password) < MIN_PASSWORD_LEN:
            raise HTTPException(status_code=400,
                                detail=f"Password must be at least {MIN_PASSWORD_LEN} characters")
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
        changes = data.model_dump(exclude_none=True)

        # Guard: never leave the platform with zero active admins. Demoting the last
        # admin (role away from ADMIN) or deactivating them would lock EVERYONE out of
        # admin functions with no way back in. Refuse unless another active admin exists.
        if u.role == UserRole.ADMIN:
            losing_admin = (
                (changes.get("role") is not None and changes["role"] != UserRole.ADMIN)
                or (changes.get("is_active") is False)
            )
            if losing_admin:
                other_admins = self.db.query(User).filter(
                    User.role == UserRole.ADMIN,
                    User.is_active == True,  # noqa: E712
                    User.id != u.id,
                ).count()
                if other_admins == 0:
                    raise HTTPException(
                        status_code=400,
                        detail="This is the only active admin. Promote another admin "
                               "before changing this account's role or status.",
                    )

        for field, value in changes.items():
            setattr(u, field, value)
        self.db.commit()
        self.db.refresh(u)
        return u

    def _set_password(self, user: User, new_password: str) -> None:
        if len(new_password or "") < MIN_PASSWORD_LEN:
            raise HTTPException(status_code=400,
                                detail=f"Password must be at least {MIN_PASSWORD_LEN} characters")
        user.hashed_password = get_password_hash(new_password)
        # Revoke every refresh token this user holds. Changing a password is the one
        # move someone makes when they think a session is compromised — but the access
        # JWT is stateless and the refresh token is what actually keeps a thief alive:
        # it mints a new access token indefinitely and slides its own 30-day expiry
        # forward each time. Without this the reset accomplished nothing and the only
        # remedy was deactivating the account. The user's other devices are signed out
        # too, which is exactly what "I changed my password" should mean.
        from app.modules.models import RefreshToken
        self.db.query(RefreshToken).filter(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked == False,  # noqa: E712
        ).update({"revoked": True}, synchronize_session=False)
        self.db.commit()

    def change_own_password(self, user: User, data: 'PasswordChange') -> None:
        """Self-service change. Requires the current password, so a stolen session
        alone can't silently lock the real owner out."""
        if not verify_password(data.current_password, user.hashed_password):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        self._set_password(user, data.new_password)

    def admin_reset_password(self, user_id: str, new_password: str) -> User:
        """Admin-only reset for a member who forgot their password. No current
        password needed — the admin's own authentication is the authorisation."""
        u = self.get_user(user_id)
        self._set_password(u, new_password)
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
