import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash, create_access_token, decode_token
from app.core.config import settings
from app.modules.models import User, UserRole, RefreshToken

bearer_scheme = HTTPBearer()
optional_bearer = HTTPBearer(auto_error=False)   # same scheme, but no 401 when the header is missing


def _hash_token(raw: str) -> str:
    """Store only the hash of a refresh token — like a password. A DB leak then
    can't be used to log in."""
    return hashlib.sha256(raw.encode()).hexdigest()


def _aware(dt: datetime) -> datetime:
    """Treat a naive datetime as UTC (defensive — the column is timezone-aware)."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole = UserRole.PROFESSOR


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str          # long-lived, revocable; used only at /auth/refresh
    token_type: str = "bearer"
    user_id: str
    email: str
    full_name: str
    role: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessTokenResponse(BaseModel):
    """Returned by /auth/refresh — a fresh access token only."""
    access_token: str
    token_type: str = "bearer"


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        # Distinct message: the account exists but was deactivated (e.g. by an admin
        # mid-session). "User not found" here was misleading — the person is real and
        # would wonder why they were suddenly signed out.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Your account has been deactivated. Contact an administrator.")
    return user


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Public-read variant of get_current_user. Returns the User when a valid token is
    present, otherwise None (NO 401). Endpoints anyone may read (e.g. the calendar) use this
    and then branch on `user is None` to decide what an anonymous caller may see."""
    if not credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload:
        return None
    user = db.query(User).filter(User.id == payload.get("sub")).first()
    if not user or not user.is_active:
        return None
    return user


def require_roles(*roles: UserRole):
    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user
    return checker


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return current_user


def require_editor(current_user: User = Depends(get_current_user)) -> User:
    """Any role allowed to CREATE or CHANGE things — i.e. everyone except Viewer.

    Viewer is a read-only role: it can browse the calendar and open details, but
    cannot create, edit, or cancel anything. Written as an explicit deny on VIEWER
    (rather than an allow-list) so a new role added later is editable by default.
    """
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is view-only — ask an admin if you need edit access.",
        )
    return current_user


class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def register(self, req: RegisterRequest) -> TokenResponse:
        # Never let the public sign-up form grant admin — the frontend hides it, but
        # the API must enforce it too (defence in depth).
        if req.role == UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="You can't register as an admin.")
        existing = self.db.query(User).filter(User.email == req.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        user = User(
            email=req.email,
            full_name=req.full_name,
            hashed_password=get_password_hash(req.password),
            role=req.role,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return self._make_token(user)

    def login(self, req: LoginRequest) -> TokenResponse:
        user = self.db.query(User).filter(User.email == req.email).first()
        if not user or not verify_password(req.password, user.hashed_password):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not user.is_active:
            raise HTTPException(status_code=403,
                                detail="Your account has been deactivated. Contact an administrator.")
        return self._make_token(user)

    def _make_token(self, user: User) -> TokenResponse:
        access = create_access_token({"sub": user.id})
        refresh = self._issue_refresh_token(user)
        return TokenResponse(
            access_token=access,
            refresh_token=refresh,
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role.value,
        )

    def _issue_refresh_token(self, user: User) -> str:
        """Mint a new refresh token: return the raw value to the client, store only
        its hash. The raw value is never persisted or logged."""
        raw = secrets.token_urlsafe(48)
        self.db.add(RefreshToken(
            user_id=user.id,
            token_hash=_hash_token(raw),
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        ))
        self.db.commit()
        return raw

    def refresh(self, raw_refresh: str) -> AccessTokenResponse:
        """Exchange a valid refresh token for a fresh access token (the silent
        renewal). Sliding expiry: each successful refresh pushes the refresh token's
        own expiry forward, so an actively-used session stays alive indefinitely."""
        row = self.db.query(RefreshToken).filter(
            RefreshToken.token_hash == _hash_token(raw_refresh)
        ).first()
        now = datetime.now(timezone.utc)
        if not row or row.revoked or _aware(row.expires_at) < now:
            raise HTTPException(status_code=401, detail="Session expired — please sign in again.")

        user = self.db.query(User).filter(User.id == row.user_id).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Account is unavailable.")

        row.expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)  # slide
        self.db.commit()
        return AccessTokenResponse(access_token=create_access_token({"sub": user.id}))

    def logout(self, raw_refresh: str) -> None:
        """Revoke a refresh token so it can never mint another access token. The
        current access token still works until it expires (≤15 min), then it's dead."""
        row = self.db.query(RefreshToken).filter(
            RefreshToken.token_hash == _hash_token(raw_refresh)
        ).first()
        if row and not row.revoked:
            row.revoked = True
            self.db.commit()

    def logout_all(self, user_id: str) -> int:
        """'Log out everywhere' — revoke every active refresh token for a user."""
        n = self.db.query(RefreshToken).filter(
            RefreshToken.user_id == user_id, RefreshToken.revoked == False
        ).update({"revoked": True})
        self.db.commit()
        return n
