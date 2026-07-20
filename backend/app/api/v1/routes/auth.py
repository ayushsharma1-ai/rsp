from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.limiter import limiter           # ← from core, not main
from app.modules.auth.service import (
    AuthService, LoginRequest, TokenResponse, RefreshRequest, AccessTokenResponse,
    get_current_user,
)
from app.modules.models import User
from app.modules.users.service import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


# Public self-signup is intentionally removed — accounts are created by an admin only
# (POST /users, admin-guarded). See users/service.create_member.


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    return AuthService(db).login(data)


@router.post("/refresh", response_model=AccessTokenResponse)
@limiter.limit("60/minute")   # legit clients hit this ~4x/hour; generous headroom for shared campus IPs
def refresh(request: Request, data: RefreshRequest, db: Session = Depends(get_db)):
    """Silent renewal: swap a valid refresh token for a fresh access token.
    No access-token auth here — the refresh token IS the credential."""
    return AuthService(db).refresh(data.refresh_token)


@router.post("/logout", status_code=204)
def logout(data: RefreshRequest, db: Session = Depends(get_db)):
    """Revoke the refresh token so this session can no longer renew. Idempotent —
    an unknown or already-revoked token is a no-op (still 204)."""
    AuthService(db).logout(data.refresh_token)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
