"""Authentication helpers for session + password management."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeSerializer
from passlib.context import CryptContext

from . import database
from .settings import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
settings = get_settings()
serializer = URLSafeSerializer(settings.secret_key, salt="liv-auth")
SESSION_COOKIE = "liv_session"


def _trim_password(password: str) -> str:
    if not isinstance(password, str):
        password = str(password)
    encoded = password.encode("utf-8")
    if len(encoded) <= 72:
        return password
    return encoded[:72].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    return pwd_context.hash(_trim_password(password))


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(_trim_password(password), password_hash)


def create_session_token(user_id: int) -> str:
    return serializer.dumps({"user_id": user_id})


def read_session_token(token: str) -> Optional[int]:
    try:
        data = serializer.loads(token)
        return int(data.get("user_id"))
    except (BadSignature, ValueError, TypeError):
        return None


def set_login_cookie(response: Response, user_id: int) -> None:
    token = create_session_token(user_id)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=False,
        max_age=60 * 60 * 24 * 7,
    )


def clear_login_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE)


def get_current_user(request: Request) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    user_id = read_session_token(token)
    if not user_id:
        return None
    record = database.get_user(user_id)
    if not record:
        return None
    return record


def require_current_user(request: Request) -> dict:
    record = get_current_user(request)
    if not record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    request.state.current_user = record
    return record


def require_admin_user(request: Request) -> dict:
    record = require_current_user(request)
    if not record.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return record


def sanitize_user(record: dict) -> dict:
    return {"id": record["id"], "username": record["username"], "is_admin": bool(record["is_admin"])}
