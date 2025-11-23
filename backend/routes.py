"""API routes that power the Liv planning backend."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, PlainTextResponse

from pydantic import ValidationError
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
    Surgery,
    SurgeryCreate,
    SurgeryCreatePayload,
    Photo,
    PhotoCreate,
    Payment,
    PaymentCreate,
    PatientSearchResult,
    Procedure,  # Alias for Surgery (backward compatibility)
    ProcedureCreate,  # Alias for SurgeryCreate (backward compatibility)
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
surgeries_router = APIRouter(prefix="/surgeries", tags=["surgeries"])
procedures_router = APIRouter(prefix="/procedures", tags=["procedures"])
upload_router = APIRouter(prefix="/uploads", tags=["uploads"])
api_tokens_router = APIRouter(prefix="/api-tokens", tags=["api tokens"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])
field_options_router = APIRouter(prefix="/field-options", tags=["field options"])
status_router = APIRouter(prefix="/status", tags=["status"])
search_router = APIRouter(tags=["search"])
config_router = APIRouter(tags=["config"])
audit_router = APIRouter(prefix="/api-requests", tags=["api requests"])

settings = get_settings()
UPLOAD_ROOT = settings.uploads_root
REQUIRED_MIN_OPTION_COUNTS: Dict[str, int] = {"status": 1, "procedure_type": 1, "payment": 1}


def _coerce_patient_payload(data: dict) -> PatientCreate:
    """Validate and normalize patient payloads (personal details only)."""
    try:
        return PatientCreate.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=json.loads(exc.json()),
        ) from exc


def _authorization_header_token(header_value: Optional[str]) -> Optional[str]:
    """Return the bearer token portion of an Authorization header, if present."""
    if not header_value:
        return None
    scheme, _, credentials = header_value.partition(" ")
    if scheme.lower() != "bearer" or not credentials:
        return None
    return credentials.strip()


def require_api_token(
    token: Optional[str] = Query(None, description="API token", alias="token"),
    authorization: Optional[str] = Header(None, convert_underscores=False),
) -> ApiToken:
    token_value = token or _authorization_header_token(authorization)
    if not token_value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token required")
    record = database.get_api_token_by_value(token_value)
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


@patients_router.get("/deleted", response_model=List[Patient])
def list_deleted_patients(_: dict = Depends(require_admin_user)) -> List[Patient]:
    """Return patients that have been soft deleted (admin only)."""
    records = database.fetch_patients(include_deleted=True, only_deleted=True)
    return [Patient(**record) for record in records]


def _remove_patient_files(file_names: list[str]) -> None:
    for name in file_names or []:
        try:
            target = UPLOAD_ROOT / Path(name)
            if target.exists():
                target.unlink()
            parent = target.parent
            if parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            continue


@patients_router.get("/{patient_id}", response_model=Patient)
def get_patient(patient_id: int) -> Patient:
    """Return the patient identified by ``patient_id``."""
    record = database.fetch_patient(patient_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return Patient(**record)


@patients_router.get("/{patient_id}/surgeries", response_model=list[Surgery])
@patients_router.get("/{patient_id}/procedures", response_model=list[Procedure])
def list_procedures(patient_id: int, include_deleted: bool = False) -> list[Procedure]:
    patient = database.fetch_patient(patient_id, include_deleted=True)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    records = database.list_surgeries_for_patient(patient_id, include_deleted=include_deleted)
    return [Procedure(**record) for record in records]


@patients_router.post("/{patient_id}/surgeries", response_model=Surgery, status_code=status.HTTP_201_CREATED)
@patients_router.post("/{patient_id}/procedures", response_model=Procedure, status_code=status.HTTP_201_CREATED)
def create_procedure(patient_id: int, payload: ProcedureCreate) -> Procedure:
    patient = database.fetch_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    created = database.create_surgery(patient_id, payload.model_dump())
    return Procedure(**created)


@patients_router.get("/{patient_id}/surgeries/{procedure_id}", response_model=Surgery)
@patients_router.get("/{patient_id}/procedures/{procedure_id}", response_model=Procedure)
def get_procedure(patient_id: int, procedure_id: int, include_deleted: bool = False) -> Procedure:
    procedure = database.fetch_surgery(procedure_id, include_deleted=include_deleted)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Procedure(**procedure)


@patients_router.put("/{patient_id}/surgeries/{procedure_id}", response_model=Surgery)
@patients_router.put("/{patient_id}/procedures/{procedure_id}", response_model=Procedure)
def update_procedure(patient_id: int, procedure_id: int, payload: ProcedureCreate) -> Procedure:
    procedure = database.fetch_surgery(procedure_id, include_deleted=True)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    updated = database.update_surgery(procedure_id, payload.model_dump())
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Procedure(**updated)


@patients_router.delete("/{patient_id}/surgeries/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
@patients_router.delete("/{patient_id}/procedures/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_procedure(patient_id: int, procedure_id: int) -> Response:
    procedure = database.fetch_surgery(procedure_id, include_deleted=True)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    removed = database.delete_surgery(procedure_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@patients_router.get("/{patient_id}/photos", response_model=List[Photo])
def list_patient_photos(patient_id: int) -> List[Photo]:
    """Return photo records linked to a patient."""
    patient = database.fetch_patient(patient_id, include_deleted=True)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    photos = database.list_photos_for_patient(patient_id)
    return [Photo(**photo) for photo in photos]


@patients_router.post("/{patient_id}/photos", response_model=Photo, status_code=status.HTTP_201_CREATED)
def create_patient_photo(patient_id: int, payload: PhotoCreate) -> Photo:
    """Create a photo record (metadata only; files are handled via /uploads)."""
    patient = database.fetch_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    record = database.create_photo(patient_id, payload.name, payload.file_path, payload.taken_at)
    return Photo(**record)


@patients_router.delete("/{patient_id}/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient_photo_record(patient_id: int, photo_id: int) -> None:
    """Delete a photo record linked to the patient."""
    photo = next((item for item in database.list_photos_for_patient(patient_id) if item["id"] == photo_id), None)
    if not photo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    database.delete_photo(photo_id)


@patients_router.get("/{patient_id}/payments", response_model=List[Payment])
def list_patient_payments(patient_id: int) -> List[Payment]:
    """Return payments linked to a patient."""
    patient = database.fetch_patient(patient_id, include_deleted=True)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    payments = database.list_payments_for_patient(patient_id)
    return [Payment(**payment) for payment in payments]


@patients_router.post("/{patient_id}/payments", response_model=Payment, status_code=status.HTTP_201_CREATED)
def create_patient_payment(patient_id: int, payload: PaymentCreate) -> Payment:
    patient = database.fetch_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    payment = database.create_payment(patient_id, payload.amount, payload.currency)
    return Payment(**payment)


@patients_router.delete("/{patient_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patient_payment(patient_id: int, payment_id: int) -> None:
    payment = next((item for item in database.list_payments_for_patient(patient_id) if item["id"] == payment_id), None)
    if not payment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    database.delete_payment(payment_id)


@patients_router.post("/", response_model=Patient, status_code=status.HTTP_201_CREATED)
def create_patient(payload: PatientCreate) -> Patient:
    """Create a new patient record (personal information only)."""
    patient_payload = _coerce_patient_payload(payload.model_dump())
    record = database.create_patient(patient_payload.model_dump())
    database.log_api_request("/patients", "POST", patient_payload.model_dump())
    return Patient(**record)


@patients_router.put("/{patient_id}", response_model=Patient)
def update_patient(patient_id: int, payload: PatientCreate) -> Patient:
    """Update the patient record identified by ``patient_id``."""
    existing = database.fetch_patient(patient_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    patient_payload = _coerce_patient_payload(payload.model_dump())
    updated = database.update_patient(patient_id, patient_payload.model_dump())
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    database.log_api_request(f"/patients/{patient_id}", "PUT", patient_payload.model_dump())
    return Patient(**updated)


@patients_router.delete("/{patient_id}", status_code=status.HTTP_200_OK)
def delete_patient_route(patient_id: int, _: dict = Depends(require_admin_user)) -> JSONResponse:
    """Soft delete the patient record (admin only)."""
    deleted = database.delete_patient(patient_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    database.log_api_request(f"/patients/{patient_id}", "DELETE", {"id": patient_id})
    return JSONResponse({"detail": "Deleted", "id": patient_id})


@patients_router.post("/{patient_id}/recover", response_model=Patient)
def recover_patient_route(patient_id: int, _: dict = Depends(require_admin_user)) -> Patient:
    """Restore a soft-deleted patient record (admin only)."""
    restored = database.restore_patient(patient_id)
    if not restored:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    return Patient(**restored)


@patients_router.delete("/{patient_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge_patient_route(patient_id: int, _: dict = Depends(require_admin_user)) -> None:
    """Permanently delete a patient record (admin only)."""
    record = database.fetch_patient(patient_id, include_deleted=True)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    photo_paths = [photo["file_path"] for photo in database.list_photos_for_patient(patient_id)]
    _remove_patient_files(photo_paths)
    deleted = database.purge_patient(patient_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to delete patient")


@patients_router.post("/multiple", response_model=List[Patient], status_code=status.HTTP_201_CREATED)
def import_patients(payload: List[PatientCreate]) -> List[Patient]:
    """Bulk-create patient records from a list of personal-info payloads."""
    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide at least one record")
    created: List[Patient] = []
    for record in payload:
        patient_payload = _coerce_patient_payload(record.model_dump())
        created_record = database.create_patient(patient_payload.model_dump())
        created.append(Patient(**created_record))
    database.log_api_request("/patients/multiple", "POST", [patient.model_dump() for patient in payload])
    return created


@surgeries_router.get("/", response_model=List[Surgery])
@procedures_router.get("/", response_model=List[Procedure])
def list_procedures_route(patient_id: Optional[int] = Query(None)) -> List[Procedure]:
    """Return every stored procedure, optionally filtered by patient."""
    records = database.list_surgeries(patient_id=patient_id)
    return [Surgery(**record) for record in records]


@surgeries_router.post("/", response_model=Surgery, status_code=status.HTTP_201_CREATED)
@procedures_router.post("/", response_model=Procedure, status_code=status.HTTP_201_CREATED)
def create_procedure_route(payload: SurgeryCreatePayload) -> Procedure:
    """Create a procedure and link it to a patient."""
    patient = database.fetch_patient(payload.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    created = database.create_surgery(payload.patient_id, payload.model_dump(exclude={"patient_id"}))
    return Surgery(**created)


@surgeries_router.get("/{procedure_id}", response_model=Surgery)
@procedures_router.get("/{procedure_id}", response_model=Procedure)
def fetch_procedure_route(procedure_id: int) -> Procedure:
    record = database.fetch_surgery(procedure_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Surgery(**record)


@surgeries_router.put("/{procedure_id}", response_model=Surgery)
@procedures_router.put("/{procedure_id}", response_model=Procedure)
def update_procedure_route(procedure_id: int, payload: SurgeryCreatePayload) -> Procedure:
    if not database.fetch_patient(payload.patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    updated = database.update_surgery(procedure_id, payload.model_dump(exclude={"patient_id"}))
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Surgery(**updated)


@surgeries_router.delete("/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
@procedures_router.delete("/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_procedure_route(procedure_id: int) -> None:
    deleted = database.delete_surgery(procedure_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")


@audit_router.get("/", response_model=List[dict])
def list_api_requests(limit: int = Query(100, ge=1, le=500), _: dict = Depends(require_admin_user)) -> List[dict]:
    """Return recent API requests (admin only)."""
    return database.fetch_api_requests(limit)


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
        alias="full_name",
        description="Preferred parameter that should contain the patient's full name (e.g. 'Randhir Sandhu').",
    ),
    name: Optional[str] = Query(
        None,
        description="Optional first/full name parameter kept for backwards compatibility; combined with surname when provided.",
    ),
    surname: Optional[str] = Query(
        None,
        description="Optional surname parameter kept for backwards compatibility; appended to the name if provided.",
    ),
) -> PatientSearchResult:
    if full_name:
        raw_value = full_name
    else:
        raw_value = " ".join(part for part in (name, surname) if part)
    normalized_value = " ".join(raw_value.split())
    if not normalized_value:
        return PatientSearchResult(success=False, message="Name is missing")
    try:
        record = database.find_patient_by_full_name(normalized_value)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not record:
        return PatientSearchResult(success=False, message="Patient record not found")
    patient = Patient(**record)
    surgery_date = None
    surgeries = database.list_surgeries_for_patient(patient.id)
    for surgery in surgeries:
        if surgery.get("procedure_date"):
            surgery_date = surgery["procedure_date"]
            break
    return PatientSearchResult(
        success=True,
        id=patient.id,
        surgery_date=surgery_date,
        patient=patient,
    )
