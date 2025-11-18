"""API routes that power the Liv planning backend."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import JSONResponse, PlainTextResponse

from . import database
from .auth import (
    clear_login_cookie,
    hash_password,
    require_admin_user,
    require_current_user,
    sanitize_user,
    set_login_cookie,
    verify_password,
)
from .models import (
    ApiToken,
    ApiTokenCreate,
    FieldOption,
    FieldOptionUpdate,
    LoginRequest,
    Patient,
    PatientCreate,
    PatientSearchResult,
    User,
    UserCreate,
    UserPasswordUpdate,
    UserRoleUpdate,
    WeeklyPlan,
    WeeklyPlanCreate,
)
from .settings import get_settings

router = APIRouter(prefix="/plans", tags=["plans"])
patients_router = APIRouter(prefix="/patients", tags=["patients"])
upload_router = APIRouter(prefix="/uploads", tags=["uploads"])
api_tokens_router = APIRouter(prefix="/api-tokens", tags=["api tokens"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])
field_options_router = APIRouter(prefix="/field-options", tags=["field options"])
status_router = APIRouter(prefix="/status", tags=["status"])
search_router = APIRouter(tags=["search"])
config_router = APIRouter(tags=["config"])

settings = get_settings()
UPLOAD_ROOT = settings.uploads_root
REQUIRED_MIN_OPTION_COUNTS: Dict[str, int] = {"status": 1, "surgery_type": 1, "payment": 1}


def require_api_token(token: str = Query(..., description="API token", alias="token")) -> ApiToken:
    record = database.get_api_token_by_value(token)
    if not record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")
    return ApiToken(**record)


@router.get("/", response_model=List[WeeklyPlan])
def list_plans() -> List[WeeklyPlan]:
    """Return every saved plan ordered by the starting week."""
    plans = database.fetch_weekly_plans()
    return [WeeklyPlan(**plan) for plan in plans]


@router.post("/", response_model=WeeklyPlan, status_code=status.HTTP_201_CREATED)
def create_plan(payload: WeeklyPlanCreate) -> WeeklyPlan:
    """Insert a new plan into the SQLite database."""
    plan_dict = payload.model_dump()
    created = database.create_weekly_plan({**plan_dict, "week_start": payload.week_start.isoformat()})
    return WeeklyPlan(**created)


@router.put("/{plan_id}", response_model=WeeklyPlan)
def update_plan(plan_id: int, payload: WeeklyPlanCreate) -> WeeklyPlan:
    """Update the plan identified by ``plan_id``."""
    updated = database.update_weekly_plan(
        plan_id,
        {**payload.model_dump(), "week_start": payload.week_start.isoformat()},
    )
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return WeeklyPlan(**updated)


@router.delete("/{plan_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int) -> None:
    """Delete a plan and return 204 even if it does not exist."""
    database.delete_weekly_plan(plan_id)


@patients_router.get("/", response_model=List[Patient])
def list_patients() -> List[Patient]:
    """Return every patient ordered by their calendar position."""
    records = database.fetch_patients()
    return [Patient(**record) for record in records]


@patients_router.get("/{patient_id}", response_model=Patient)
def get_patient(patient_id: int) -> Patient:
    """Return the patient identified by ``patient_id``."""
    record = database.fetch_patient(patient_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return Patient(**record)


@patients_router.post("/", response_model=Patient, status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate) -> Patient:
    """Create a new patient record."""
    record = database.create_patient(payload.model_dump())
    return Patient(**record)


@patients_router.put("/{patient_id}", response_model=Patient)
def update_patient(patient_id: int, payload: PatientCreate) -> Patient:
    """Update the patient record identified by ``patient_id``."""
    updated = database.update_patient(patient_id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return Patient(**updated)


def _request_origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _resolve_backend_url(request: Request) -> str:
    settings = get_settings()
    return settings.backend_url or _request_origin(request)


def _resolve_frontend_url(request: Request) -> str:
    settings = get_settings()
    if settings.frontend_url:
        return settings.frontend_url
    backend_url = settings.backend_url or _request_origin(request)
    return backend_url


@config_router.get("/app-config", response_class=JSONResponse)
def app_config(request: Request) -> dict[str, str]:
    """Expose backend/frontend URLs so the UI can configure itself."""
    return {
        "backendUrl": _resolve_backend_url(request),
        "frontendUrl": _resolve_frontend_url(request),
    }


@config_router.get("/app-config.js", response_class=PlainTextResponse)
def app_config_js(request: Request) -> str:
    """Serve a JS snippet that sets window.APP_CONFIG."""
    payload = json.dumps(
        {
            "backendUrl": _resolve_backend_url(request),
            "frontendUrl": _resolve_frontend_url(request),
        },
        ensure_ascii=False,
    )
    return f"window.APP_CONFIG = {payload};"


@auth_router.post("/login", response_model=User)
def login(payload: LoginRequest, response: Response) -> User:
    record = database.get_user_by_username(payload.username)
    if not record or not verify_password(payload.password, record["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    set_login_cookie(response, record["id"])
    return User(**sanitize_user(record))


@auth_router.post("/logout")
def logout(response: Response, _: dict = Depends(require_current_user)) -> dict[str, str]:
    clear_login_cookie(response)
    return {"detail": "Logged out"}


@auth_router.get("/me", response_model=User)
def current_user_route(current_user: dict = Depends(require_current_user)) -> User:
    return User(**sanitize_user(current_user))


@auth_router.get("/users", response_model=List[User])
def list_users_route(_: dict = Depends(require_admin_user)) -> List[User]:
    users = database.list_users()
    return [User(**sanitize_user(user)) for user in users]


@auth_router.post("/users", response_model=User, status_code=status.HTTP_201_CREATED)
def create_user_route(payload: UserCreate, _: dict = Depends(require_admin_user)) -> User:
    existing = database.get_user_by_username(payload.username)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    record = database.create_user(payload.username, hash_password(payload.password), payload.is_admin)
    return User(**sanitize_user(record))


@auth_router.put("/users/{user_id}/password", response_model=User)
def update_user_password_route(
    user_id: int,
    payload: UserPasswordUpdate,
    _: dict = Depends(require_admin_user),
) -> User:
    updated = database.update_user_password(user_id, hash_password(payload.password))
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    record = database.get_user(user_id)
    return User(**sanitize_user(record))


@auth_router.put("/users/{user_id}/role", response_model=User)
def update_user_role_route(
    user_id: int,
    payload: UserRoleUpdate,
    current_user: dict = Depends(require_admin_user),
) -> User:
    record = database.get_user(user_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user_id == current_user["id"] and not payload.is_admin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove your own admin rights")
    if record["is_admin"] and not payload.is_admin:
        admins = [user for user in database.list_users() if user["is_admin"]]
        if len(admins) <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one admin is required")
    updated = database.update_user_admin_flag(user_id, payload.is_admin)
    if not updated:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to update user")
    record = database.get_user(user_id)
    return User(**sanitize_user(record))


@auth_router.delete(
    "/users/{user_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT
)
def delete_user_route(user_id: int, current_user: dict = Depends(require_admin_user)) -> None:
    if user_id == current_user["id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
    record = database.get_user(user_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if record["is_admin"]:
        admins = [user for user in database.list_users() if user["is_admin"]]
        if len(admins) <= 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one admin is required")
    deleted = database.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to delete user")


@field_options_router.get("/", response_model=Dict[str, List[FieldOption]])
def list_field_options_route(_: dict = Depends(require_current_user)) -> Dict[str, List[FieldOption]]:
    """Return every configurable select option list."""
    return {field: [FieldOption(**option) for option in options] for field, options in database.list_field_options().items()}


@field_options_router.get("/{field_name}", response_model=List[FieldOption])
def get_field_options_route(field_name: str, _: dict = Depends(require_current_user)) -> List[FieldOption]:
    """Return options for a specific field."""
    try:
        options = database.get_field_options(field_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [FieldOption(**option) for option in options]


@field_options_router.put("/{field_name}", response_model=List[FieldOption])
def update_field_options_route(
    field_name: str,
    payload: FieldOptionUpdate,
    _: dict = Depends(require_admin_user),
) -> List[FieldOption]:
    """Replace the option list for the given field."""
    min_required = REQUIRED_MIN_OPTION_COUNTS.get(field_name, 0)
    if len(payload.options) < min_required:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} requires at least {min_required} option(s)",
        )
    try:
        normalized = database.update_field_options(field_name, [option.model_dump() for option in payload.options])
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [FieldOption(**option) for option in normalized]


@api_tokens_router.get("/", response_model=List[ApiToken])
def list_api_tokens(current_user: dict = Depends(require_admin_user)) -> List[ApiToken]:
    """Return every API token created by the current user (tokens do not expire)."""
    records = database.list_api_tokens(user_id=current_user["id"])
    return [ApiToken(**record) for record in records]


@api_tokens_router.post("/", response_model=ApiToken, status_code=status.HTTP_201_CREATED)
def create_api_token(payload: ApiTokenCreate, current_user: dict = Depends(require_admin_user)) -> ApiToken:
    """Create a new API token tied to the requesting user."""
    record = database.create_api_token(payload.name, current_user["id"])
    return ApiToken(**record)


@api_tokens_router.delete(
    "/{token_id}", response_model=None, status_code=status.HTTP_204_NO_CONTENT
)
def delete_api_token(token_id: int, current_user: dict = Depends(require_admin_user)) -> None:
    """Delete one of the current user's API tokens by id."""
    deleted = database.delete_api_token(token_id, user_id=current_user["id"])
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found")


def _sanitize_segment(segment: str) -> str:
    value = re.sub(r"[^a-z0-9_-]+", "-", segment.lower()).strip("-")
    return value or "patient"


def _sanitize_relative_path(value: str) -> Path:
    candidate = Path(value.strip("/"))
    if candidate.is_absolute() or ".." in candidate.parts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file path")
    return candidate


@upload_router.post("/{patient_last_name}", status_code=status.HTTP_201_CREATED)
async def upload_patient_photos(
    patient_last_name: str,
    patient_id: Optional[int] = None,
    files: List[UploadFile] = File(...),
) -> dict[str, object]:
    """Persist uploaded photos under uploads/<last-name>/."""
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files provided")

    safe_folder = _sanitize_segment(patient_last_name)
    target_dir = UPLOAD_ROOT / safe_folder
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_files: List[str] = []
    relative_paths: List[str] = []
    for index, upload in enumerate(files):
        filename = upload.filename or f"upload-{index}"
        destination = target_dir / filename
        contents = await upload.read()
        destination.write_bytes(contents)
        saved_files.append(filename)
        relative_paths.append(f"{safe_folder}/{filename}")

    updated_photos = None
    if patient_id is not None:
        updated_photos = database.append_patient_photos(patient_id, relative_paths)
        if updated_photos is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")

    return {
        "patientFolder": safe_folder,
        "files": saved_files,
        "filePaths": relative_paths,
        "photoFiles": updated_photos,
    }


@upload_router.delete("/{patient_id}", response_model=dict)
def delete_patient_photo(patient_id: int, file: str) -> dict[str, object]:
    """Remove a photo from disk and unregister it from the patient record."""
    relative = _sanitize_relative_path(file)
    absolute_path = UPLOAD_ROOT / relative
    if absolute_path.exists():
        absolute_path.unlink()
        # Remove empty folder if nothing remains
        parent = absolute_path.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()

    updated = database.remove_patient_photo(patient_id, str(relative))
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return {"photoFiles": updated}


@status_router.get("/connection-check")
def verify_api_connection(_: ApiToken = Depends(require_api_token)) -> dict[str, str]:
    """Confirm that an API token is valid for integrations."""
    return {"detail": "API token verified"}


@search_router.get("/search", response_model=PatientSearchResult)
def search_patients_route(
    full_name: Optional[str] = Query(
        None,
        alias="name",
        description="Patient full name (e.g. 'Randhir Sandhu'). If provided, this overrides the separate surname.",
    ),
    surname: Optional[str] = Query(
        None,
        description="Optional surname parameter kept for backwards compatibility; appended to the name if provided.",
    ),
) -> PatientSearchResult:
    raw_value = " ".join(part for part in (full_name, surname) if part)
    normalized_value = " ".join(raw_value.split())
    if not normalized_value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide the patient's full name")
    try:
        record = database.find_patient_by_full_name(normalized_value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not record:
        return PatientSearchResult(success=False, message="Patient record not found")
    return PatientSearchResult(success=True, id=record["id"], surgery_date=record["patient_date"])
