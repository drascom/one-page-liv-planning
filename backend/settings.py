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
    static_root: Path = BASE_DIR / "frontend"
    html_root: Path = static_root / "html"
    uploads_root: Path = BASE_DIR / "uploads"
    secret_key: str = os.getenv("APP_SECRET_KEY", "change-me")
    default_admin_password: str = os.getenv("DEFAULT_ADMIN_PASSWORD", "changeme")
    
    # Google Auth Settings
    google_client_id: Optional[str] = os.getenv("GOOGLE_CLIENT_ID")
    google_client_secret: Optional[str] = os.getenv("GOOGLE_CLIENT_SECRET")
    google_project_id: Optional[str] = os.getenv("GOOGLE_PROJECT_ID")
    google_token_json: Optional[str] = os.getenv("GOOGLE_TOKEN_JSON")


@lru_cache
def get_settings() -> Settings:
    return Settings()
