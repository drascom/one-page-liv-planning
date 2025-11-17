"""FastAPI application that exposes Liv's weekly planning data."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import database
from .routes import (
    api_tokens_router,
    config_router,
    patients_router,
    router as plans_router,
    upload_router,
)
from .settings import get_settings

app = FastAPI(title="Liv Planning API", version="0.1.0")
settings = get_settings()
settings.uploads_root.mkdir(parents=True, exist_ok=True)

allowed_origins = list({settings.frontend_url, settings.backend_url})

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=str(settings.static_root)), name="static")
app.mount("/uploaded-files", StaticFiles(directory=str(settings.uploads_root)), name="uploaded-files")


@app.on_event("startup")
def startup_event() -> None:
    database.init_db()


def create_app() -> FastAPI:
    """Return a configured FastAPI app (useful for testing)."""
    database.init_db()
    api = FastAPI(title="Liv Planning API", version="0.1.0")
    api.include_router(plans_router)
    api.include_router(patients_router)
    api.include_router(api_tokens_router)
    api.include_router(config_router)
    api.include_router(upload_router)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    api.mount("/static", StaticFiles(directory=str(settings.static_root)), name="static")
    api.mount("/uploaded-files", StaticFiles(directory=str(settings.uploads_root)), name="uploaded-files")
    return api


app.include_router(plans_router)
app.include_router(patients_router)
app.include_router(api_tokens_router)
app.include_router(config_router)
app.include_router(upload_router)


@app.get("/", include_in_schema=False)
def serve_index() -> FileResponse:
    return FileResponse(settings.static_root / "index.html")


@app.get("/patient.html", include_in_schema=False)
def serve_patient() -> FileResponse:
    return FileResponse(settings.static_root / "patient.html")


@app.get("/settings.html", include_in_schema=False)
def serve_settings() -> FileResponse:
    return FileResponse(settings.static_root / "settings.html")
