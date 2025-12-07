"""Helpers for working with the application's canonical timezone (London)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

LONDON_TIMEZONE = ZoneInfo("Europe/London")


def london_now() -> datetime:
    """Return the current datetime in Europe/London."""
    return datetime.now(LONDON_TIMEZONE)


def london_now_iso() -> str:
    """Return an ISO 8601 timestamp anchored to Europe/London."""
    return london_now().isoformat()
