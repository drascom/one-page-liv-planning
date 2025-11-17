"""API routes that power the Liv planning backend."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, PlainTextResponse

from . import database
from .models import ApiToken, ApiTokenCreate, Patient, PatientCreate, WeeklyPlan, WeeklyPlanCreate
from .settings import get_settings

router = APIRouter(prefix="/plans", tags=["plans"])
patients_router = APIRouter(prefix="/patients", tags=["patients"])
upload_router = APIRouter(prefix="/uploads", tags=["uploads"])
api_tokens_router = APIRouter(prefix="/api-tokens", tags=["api tokens"])
config_router = APIRouter(tags=["config"])

settings = get_settings()
UPLOAD_ROOT = settings.uploads_root


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


@config_router.get("/app-config", response_class=JSONResponse)
def app_config() -> dict[str, str]:
    """Expose backend/frontend URLs so the UI can configure itself."""
    settings = get_settings()
    return {"backendUrl": settings.backend_url, "frontendUrl": settings.frontend_url}


@config_router.get("/app-config.js", response_class=PlainTextResponse)
def app_config_js() -> str:
    """Serve a JS snippet that sets window.APP_CONFIG."""
    settings = get_settings()
    payload = json.dumps(
        {"backendUrl": settings.backend_url, "frontendUrl": settings.frontend_url},
        ensure_ascii=False,
    )
    return f"window.APP_CONFIG = {payload};"


@api_tokens_router.get("/", response_model=List[ApiToken])
def list_api_tokens() -> List[ApiToken]:
    """Return every API token (tokens do not expire)."""
    records = database.list_api_tokens()
    return [ApiToken(**record) for record in records]


@api_tokens_router.post("/", response_model=ApiToken, status_code=status.HTTP_201_CREATED)
def create_api_token(payload: ApiTokenCreate) -> ApiToken:
    """Create a new API token that never expires."""
    record = database.create_api_token(payload.name)
    return ApiToken(**record)


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
