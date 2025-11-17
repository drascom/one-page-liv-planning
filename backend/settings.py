"""Environment-aware settings loader for the Liv planning app."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

if ENV_PATH.exists():
    load_dotenv(ENV_PATH)


class Settings(BaseModel):
    backend_url: Optional[str] = os.getenv("BACKEND_URL")
    frontend_url: Optional[str] = os.getenv("FRONTEND_URL")
    static_root: Path = BASE_DIR
    uploads_root: Path = BASE_DIR / "uploads"
    secret_key: str = os.getenv("APP_SECRET_KEY", "change-me")
    default_admin_password: str = os.getenv("DEFAULT_ADMIN_PASSWORD", "changeme")


@lru_cache
def get_settings() -> Settings:
    return Settings()
