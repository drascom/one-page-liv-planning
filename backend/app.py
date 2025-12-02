"""FastAPI application that exposes Liv's weekly planning data."""
from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from urllib.parse import quote

from . import database
from .auth import get_current_user, hash_password, require_current_user
from .routes import (
    api_tokens_router,
    audit_router,
    auth_router,
    config_router,
    drive_router,
    field_options_router,
    patients_router,
    procedures_router,
    require_api_token,
    router as plans_router,
    search_router,
    status_router,
)
from .google_routes import router as google_auth_router
from .realtime import realtime_router
from .settings import get_settings

def _resolve_allowed_origins() -> list[str]:
    settings = get_settings()
    origins = {value.rstrip("/") for value in (settings.frontend_url, settings.backend_url) if value}
    return list(origins)


def _build_cors_config() -> dict[str, object]:
    origins = _resolve_allowed_origins()
    if origins:
        return {"allow_origins": origins, "allow_origin_regex": None}
    return {"allow_origins": [], "allow_origin_regex": r"https?://.*"}


app = FastAPI(title="Liv Planning API", version="0.1.0")
settings = get_settings()
settings.uploads_root.mkdir(parents=True, exist_ok=True)

cors_config = _build_cors_config()

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_config["allow_origins"],
    allow_origin_regex=cors_config["allow_origin_regex"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.mount("/static", StaticFiles(directory=str(settings.static_root)), name="static")

PROTECTED_FRONTEND_PREFIXES: tuple[str, ...] = (
    "/plans",
    "/patients",
    "/procedures",
    "/field-options",
    "/api-tokens",
)


def _redirect_to_login(request: Request) -> RedirectResponse:
    # If already at /login, avoid infinite redirect
    if request.url.path == "/login":
        return RedirectResponse("/login")

    next_path = request.url.path
    if request.url.query:
        next_path = f"{next_path}?{request.url.query}"
    
    encoded = quote(next_path, safe="") if next_path else ""
    target = "/login"
    if encoded and encoded != "/":
        target = f"/login?next={encoded}"
    return RedirectResponse(target)


def _path_requires_frontend_login(path: str) -> bool:
    """Return True when the request should only be served to authenticated users."""
    for prefix in PROTECTED_FRONTEND_PREFIXES:
        if path == prefix or path == f"{prefix}/" or path.startswith(f"{prefix}/"):
            return True
    return False


def _prefers_html(request: Request) -> bool:
    accept = request.headers.get("accept") or ""
    return "text/html" in accept.lower()


def _register_frontend_security_middleware(api: FastAPI) -> None:
    @api.middleware("http")
    async def enforce_frontend_authentication(request: Request, call_next):
        """Require authenticated sessions for internal (non-API) endpoints."""
        if request.method == "OPTIONS":
            return await call_next(request)
        path = request.url.path
        if not _path_requires_frontend_login(path):
            return await call_next(request)
        if get_current_user(request):
            return await call_next(request)
        if _prefers_html(request):
            return _redirect_to_login(request)
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)


@app.on_event("startup")
def startup_event() -> None:
    print(f"Initializing database at: {database.DB_PATH}")
    database.init_db()
    database.seed_default_admin_user(hash_password(settings.default_admin_password))


def create_app() -> FastAPI:
    """Return a configured FastAPI app (useful for testing)."""
    database.init_db()
    database.seed_default_admin_user(hash_password(settings.default_admin_password))
    api = FastAPI(title="Liv Planning API", version="0.1.0")
    api.include_router(config_router)
    api.include_router(auth_router)
    auth_dependency = [Depends(require_current_user)]
    api.include_router(plans_router, dependencies=auth_dependency, include_in_schema=False)
    api.include_router(patients_router, dependencies=auth_dependency, include_in_schema=False)
    api.include_router(procedures_router, dependencies=auth_dependency, include_in_schema=False)
    api.include_router(api_tokens_router, dependencies=auth_dependency)
    api.include_router(audit_router, dependencies=auth_dependency)
    api.include_router(field_options_router, dependencies=auth_dependency, include_in_schema=False)
    api.include_router(status_router, dependencies=auth_dependency)
    api.include_router(drive_router, dependencies=auth_dependency)
    api.include_router(google_auth_router)
    api.include_router(realtime_router, include_in_schema=False)
    for protected_router in (
        plans_router,
        patients_router,
        procedures_router,
        field_options_router,
        status_router,
        search_router,
        drive_router,
    ):
        api.include_router(
            protected_router,
            prefix="/api/v1",
            dependencies=[Depends(require_api_token)],
        )
    api.include_router(
        audit_router,
        prefix="/api/v1",
        dependencies=[Depends(require_api_token)],
        include_in_schema=False,
    )
    cors_config = _build_cors_config()
    api.add_middleware(
        CORSMiddleware,
        allow_origins=cors_config["allow_origins"],
        allow_origin_regex=cors_config["allow_origin_regex"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=True,
    )
    api.mount("/static", StaticFiles(directory=str(settings.static_root)), name="static")
    _register_frontend_security_middleware(api)
    return api


app.include_router(config_router)
app.include_router(auth_router)
auth_dependency = [Depends(require_current_user)]
app.include_router(plans_router, dependencies=auth_dependency, include_in_schema=False)
app.include_router(patients_router, dependencies=auth_dependency, include_in_schema=False)
app.include_router(procedures_router, dependencies=auth_dependency, include_in_schema=False)
app.include_router(api_tokens_router, dependencies=auth_dependency)
app.include_router(audit_router, dependencies=auth_dependency)
app.include_router(field_options_router, dependencies=auth_dependency, include_in_schema=False)
app.include_router(status_router, dependencies=auth_dependency)
app.include_router(drive_router, dependencies=auth_dependency)
app.include_router(google_auth_router)
app.include_router(realtime_router, include_in_schema=False)
for protected_router in (
    plans_router,
    patients_router,
    procedures_router,
    field_options_router,
    status_router,
    search_router,
    drive_router,
):
    app.include_router(
        protected_router,
        prefix="/api/v1",
        dependencies=[Depends(require_api_token)],
    )
app.include_router(
    audit_router,
    prefix="/api/v1",
    dependencies=[Depends(require_api_token)],
    include_in_schema=False,
)

_register_frontend_security_middleware(app)


@app.get("/", include_in_schema=False)
def serve_index(request: Request):
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "index.html")


@app.get("/patient.html", include_in_schema=False)
def serve_patient(request: Request):
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "patient.html")


@app.get("/settings.html", include_in_schema=False)
def serve_settings(request: Request):
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "settings.html")


@app.get("/customers.html", include_in_schema=False)
@app.get("/customers", include_in_schema=False)
def serve_customers(request: Request):
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "customers.html")


@app.get("/merge-patients.html", include_in_schema=False)
@app.get("/merge-patients", include_in_schema=False)
def serve_merge_patients(request: Request):
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "merge-patients.html")


@app.get("/test-drive", include_in_schema=False)
def serve_test_drive(request: Request):
    # Only allow authenticated admins ideally, but for dev we allow logged in users
    if not get_current_user(request):
        return _redirect_to_login(request)
    return FileResponse(settings.html_root / "test-drive.html")

@app.get("/login", include_in_schema=False)
def serve_login(request: Request):
    if get_current_user(request):
        next_url = request.query_params.get("next") or "/"
        return RedirectResponse(next_url)
    return FileResponse(settings.html_root / "login.html")
