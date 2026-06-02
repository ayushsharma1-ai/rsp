from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.limiter import limiter           # ← from core, not main
from app.modules.auth.service import (
    AuthService, RegisterRequest, LoginRequest, TokenResponse, get_current_user
)
from app.modules.models import User
from app.modules.users.service import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
@limiter.limit("10/minute")
def register(request: Request, data: RegisterRequest, db: Session = Depends(get_db)):
    return AuthService(db).register(data)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    return AuthService(db).login(data)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
