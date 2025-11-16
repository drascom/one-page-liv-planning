"""FastAPI application that exposes Liv's weekly planning data."""
from __future__ import annotations

from fastapi import FastAPI

from . import database
from .routes import router as plans_router

app = FastAPI(title="Liv Planning API", version="0.1.0")


@app.on_event("startup")
def startup_event() -> None:
    database.init_db()


def create_app() -> FastAPI:
    """Return a configured FastAPI app (useful for testing)."""
    database.init_db()
    api = FastAPI(title="Liv Planning API", version="0.1.0")
    api.include_router(plans_router)
    return api


app.include_router(plans_router)
