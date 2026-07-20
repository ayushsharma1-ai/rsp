from datetime import datetime, timedelta, timezone
from typing import Optional
import bcrypt
from jose import JWTError, jwt
from app.core.config import settings

# Password hashing uses the `bcrypt` library DIRECTLY — not passlib.
# Why: passlib 1.7.4 (its final release, 2020, now unmaintained) breaks on modern
# bcrypt (>= 4.1 / 5.0). It reads the removed `bcrypt.__about__.__version__`, and its
# backend self-test feeds a >72-byte string that bcrypt 5.0 rejects with a ValueError,
# so passlib's bcrypt backend fails to initialise at all. bcrypt's own API is small
# and stable, so we call it straight. Existing bcrypt hashes (incl. any made earlier
# via passlib) still verify — they're standard bcrypt.
#
# bcrypt only ever uses the first 72 bytes of the password; bcrypt 5.0 raises instead
# of silently truncating, so we truncate to 72 bytes ourselves to match that contract.


def _to72(password: str) -> bytes:
    return password.encode("utf-8")[:72]


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(_to72(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(_to72(plain_password), hashed_password.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
