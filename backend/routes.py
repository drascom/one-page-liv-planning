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
import requests
from fastapi.responses import JSONResponse, PlainTextResponse

from pydantic import ValidationError
from . import database
from .google_auth import get_access_token
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
    ActivityEvent,
    ApiToken,
    ApiTokenCreate,
    FieldOption,
    FieldOptionUpdate,
    LoginRequest,
    Patient,
    PatientCreate,
    OperationResult,
    Procedure,
    ProcedureMetadataDeleteRequest,
    ProcedureMetadataSearchResponse,
    ProcedureCreate,
    ProcedureCreatePayload,
    ProcedureListResponse,
    ProcedureSearchResult,
    DeletedProcedureRecord,
    Photo,
    PhotoCreate,
    Payment,
    PaymentCreate,
    PatientSearchResult,
    User,
    UserCreate,
    UserPasswordUpdate,
    UserRoleUpdate,
    WeeklyPlan,
    WeeklyPlanCreate,
)
from .realtime import publish_event
from .settings import get_settings

router = APIRouter(prefix="/plans", tags=["plans"])
patients_router = APIRouter(prefix="/patients", tags=["patients"])
procedures_router = APIRouter(prefix="/procedures", tags=["procedures"])
upload_router = APIRouter(prefix="/uploads", tags=["uploads"])
api_tokens_router = APIRouter(prefix="/api-tokens", tags=["api tokens"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])
field_options_router = APIRouter(prefix="/field-options", tags=["field options"])
status_router = APIRouter(prefix="/status", tags=["status"])
search_router = APIRouter(tags=["search"])
config_router = APIRouter(tags=["config"])
audit_router = APIRouter(prefix="/api-requests", tags=["api requests"])
drive_router = APIRouter(prefix="/drive-image", tags=["drive"])

settings = get_settings()
UPLOAD_ROOT = settings.uploads_root
REQUIRED_MIN_OPTION_COUNTS: Dict[str, int] = {
    "status": 1,
    "procedure_type": 1,
    "package_type": 1,
    "agency": 1,
    "payment": 1,
}


def _patient_label(patient: Optional[dict]) -> str:
    if not patient:
        return "Patient"
    first = (patient.get("first_name") or "").strip()
    last = (patient.get("last_name") or "").strip()
    name = f"{first} {last}".strip()
    return name or f"Patient #{patient.get('id')}"


def _procedure_summary(action: str, procedure: dict, patient: Optional[dict]) -> str:
    patient_name = _patient_label(patient)
    procedure_date = procedure.get("procedure_date") or "unscheduled date"
    action_map = {
        "created": "scheduled",
        "updated": "updated",
        "deleted": "removed",
    }
    verb = action_map.get(action, action)
    return f"{patient_name} procedure on {procedure_date} {verb}"


async def _emit_patient_event(action: str, patient: dict, request: Request) -> None:
    summary_map = {
        "created": f"{_patient_label(patient)} was added",
        "updated": f"{_patient_label(patient)} was updated",
        "deleted": f"{_patient_label(patient)} was deleted",
    }
    summary = summary_map.get(action, f"{_patient_label(patient)} changed")
    await publish_event(
        request,
        entity="patient",
        action=action,
        entity_id=patient.get("id"),
        summary=summary,
        data={
            "patient_id": patient.get("id"),
            "deleted": patient.get("deleted", False),
            "patient_name": _patient_label(patient),
        },
    )


async def _emit_procedure_event(
    action: str,
    procedure: dict,
    request: Request,
    patient: Optional[dict] = None,
) -> None:
    patient_record = patient or database.fetch_patient(
        procedure.get("patient_id"),
        include_deleted=True,
    )
    summary = _procedure_summary(action, procedure, patient_record)
    await publish_event(
        request,
        entity="procedure",
        action=action,
        entity_id=procedure.get("id"),
        summary=summary,
        data={
            "procedure_id": procedure.get("id"),
            "patient_id": procedure.get("patient_id"),
            "procedure_date": procedure.get("procedure_date"),
            "deleted": bool(procedure.get("deleted")),
            "patient_name": _patient_label(patient_record),
        },
    )


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
    request: Request,
    authorization: Optional[str] = Header(None, convert_underscores=False),
) -> ApiToken:
    token_value = _authorization_header_token(authorization)
    if not token_value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API token required")
    record = database.get_api_token_by_value(token_value)
    if not record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API token")
    token = ApiToken(**record)
    request.state.api_token = token
    return token


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


@patients_router.get("/{patient_id}/procedures", response_model=ProcedureListResponse)
def list_procedures(patient_id: int, include_deleted: bool = False) -> ProcedureListResponse:
    patient = database.fetch_patient(patient_id, include_deleted=True)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    records = database.list_procedures_for_patient(patient_id, include_deleted=include_deleted)
    procedures = [Procedure(**record) for record in records]
    if not procedures:
        return ProcedureListResponse(success=False, message="No procedures found for this patient.", procedures=[])
    return ProcedureListResponse(success=True, procedures=procedures)


@patients_router.post("/{patient_id}/procedures", response_model=OperationResult, status_code=status.HTTP_201_CREATED)
async def create_procedure(patient_id: int, payload: ProcedureCreate, request: Request) -> OperationResult:
    patient = database.fetch_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    try:
        created = database.create_procedure(patient_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    procedure_record = database.fetch_procedure(created["id"])
    if procedure_record:
        await _emit_procedure_event("created", procedure_record, request, patient=patient)
    return OperationResult(success=True, id=created["id"], message="Procedure created")


@patients_router.get("/{patient_id}/procedures/{procedure_id}", response_model=Procedure)
def get_procedure(patient_id: int, procedure_id: int, include_deleted: bool = False) -> Procedure:
    procedure = database.fetch_procedure(procedure_id, include_deleted=include_deleted)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Procedure(**procedure)


@patients_router.put("/{patient_id}/procedures/{procedure_id}", response_model=OperationResult)
async def update_procedure(
    patient_id: int,
    procedure_id: int,
    payload: ProcedureCreate,
    request: Request,
) -> OperationResult:
    procedure = database.fetch_procedure(procedure_id, include_deleted=True)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    try:
        updated = database.update_procedure(procedure_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    refreshed = database.fetch_procedure(procedure_id)
    if refreshed:
        await _emit_procedure_event("updated", refreshed, request)
    return OperationResult(success=True, id=procedure_id, message="Procedure updated")


@patients_router.delete(
    "/{patient_id}/procedures/{procedure_id}",
    response_model=OperationResult,
    status_code=status.HTTP_200_OK,
)
async def delete_procedure(patient_id: int, procedure_id: int, request: Request) -> OperationResult:
    procedure = database.fetch_procedure(procedure_id, include_deleted=True)
    if not procedure or procedure["patient_id"] != patient_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    removed = database.delete_procedure(procedure_id)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    await _emit_procedure_event("deleted", procedure, request)
    return OperationResult(success=True, id=procedure_id)


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


@patients_router.post("/", response_model=OperationResult, status_code=status.HTTP_201_CREATED)
async def create_patient(payload: PatientCreate, request: Request) -> OperationResult:
    """Create a new patient record (personal information only)."""
    patient_payload = _coerce_patient_payload(payload.model_dump())
    record = database.create_patient(patient_payload.model_dump())
    result = OperationResult(success=True, id=record["id"], message="Patient created")
    database.log_api_request("/patients", "POST", patient_payload.model_dump(), result.model_dump())
    await _emit_patient_event("created", record, request)
    return result


@patients_router.put("/{patient_id}", response_model=OperationResult)
async def update_patient(patient_id: int, payload: PatientCreate, request: Request) -> OperationResult:
    """Update the patient record identified by ``patient_id``."""
    existing = database.fetch_patient(patient_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    patient_payload = _coerce_patient_payload(payload.model_dump())
    updated = database.update_patient(patient_id, patient_payload.model_dump())
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    result = OperationResult(success=True, id=patient_id, message="Patient updated")
    database.log_api_request(f"/patients/{patient_id}", "PUT", patient_payload.model_dump(), result.model_dump())
    refreshed = database.fetch_patient(patient_id)
    if refreshed:
        await _emit_patient_event("updated", refreshed, request)
    return result


@patients_router.delete("/{patient_id}", status_code=status.HTTP_200_OK)
async def delete_patient_route(
    patient_id: int,
    request: Request,
    _: dict = Depends(require_admin_user),
) -> JSONResponse:
    """Soft delete the patient record (admin only)."""
    record = database.fetch_patient(patient_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    deleted = database.delete_patient(patient_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    response_payload = {"detail": "Deleted", "id": patient_id}
    database.log_api_request(f"/patients/{patient_id}", "DELETE", {"id": patient_id}, response_payload)
    record["deleted"] = True
    await _emit_patient_event("deleted", record, request)
    return JSONResponse(response_payload)


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
    request_payload = [patient.model_dump() for patient in payload]
    response_payload = [patient.model_dump() for patient in created]
    database.log_api_request("/patients/multiple", "POST", request_payload, response_payload)
    return created


@procedures_router.get("/", response_model=List[Procedure])
def list_procedures_route(patient_id: Optional[int] = Query(None)) -> List[Procedure]:
    """Return every stored procedure, optionally filtered by patient."""
    records = database.list_procedures(patient_id=patient_id)
    return [Procedure(**record) for record in records]


@procedures_router.post("/", response_model=OperationResult, status_code=status.HTTP_201_CREATED)
async def create_procedure_route(payload: ProcedureCreatePayload, request: Request) -> OperationResult:
    """Create a procedure and link it to a patient."""
    patient = database.fetch_patient(payload.patient_id)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    try:
        created = database.create_procedure(payload.patient_id, payload.model_dump(exclude={"patient_id"}))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    procedure_record = database.fetch_procedure(created["id"])
    if procedure_record:
        await _emit_procedure_event("created", procedure_record, request, patient=patient)
    return OperationResult(success=True, id=created["id"], message="Procedure created")


@procedures_router.get("/search", response_model=ProcedureSearchResult)
def search_procedure_route(
    patient_id: Optional[int] = Query(
        None, description="Patient identifier to search (required when procedure_id is omitted)"
    ),
    procedure_id: Optional[int] = Query(
        None, description="Direct procedure identifier (optional when patient_id is supplied)"
    ),
    procedure_date: Optional[str] = Query(None, description="ISO procedure date (YYYY-MM-DD) to match"),
    include_deleted: bool = Query(False, description="Include deleted procedures in the search"),
) -> ProcedureSearchResult:
    if procedure_id is None and patient_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide procedure_id or patient_id to search.",
        )
    if procedure_id is not None:
        record = database.fetch_procedure(procedure_id, include_deleted=include_deleted)
        if not record:
            return ProcedureSearchResult(success=False, message="Procedure not found")
        if patient_id is not None and record["patient_id"] != patient_id:
            return ProcedureSearchResult(success=False, message="Procedure does not belong to this patient")
        return ProcedureSearchResult(success=True, procedure=Procedure(**record))
    assert patient_id is not None
    patient = database.fetch_patient(patient_id, include_deleted=True)
    if not patient:
        return ProcedureSearchResult(success=False, message="Patient record not found")
    record = None
    if procedure_date:
        try:
            record = database.find_procedure_by_patient_and_date(
                patient_id,
                procedure_date,
                include_deleted=include_deleted,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    else:
        procedures = database.list_procedures_for_patient(
            patient_id,
            include_deleted=include_deleted,
        )
        record = procedures[0] if procedures else None
    if not record:
        return ProcedureSearchResult(success=False, message="Procedure not found")
    return ProcedureSearchResult(success=True, procedure=Procedure(**record))


@procedures_router.get("/deleted", response_model=List[DeletedProcedureRecord])
def list_deleted_procedures_route(_: dict = Depends(require_admin_user)) -> List[DeletedProcedureRecord]:
    """Return soft-deleted procedures so admins can manage them."""
    deleted_records = database.fetch_deleted_procedures()
    entries: List[DeletedProcedureRecord] = []
    for record in deleted_records:
        patient = database.fetch_patient(record["patient_id"], include_deleted=True)
        if not patient:
            continue
        entries.append(
            DeletedProcedureRecord(
                procedure=Procedure(**record),
                patient=Patient(**patient),
            )
        )
    return entries


@procedures_router.post("/{procedure_id}/recover", response_model=Procedure)
def recover_procedure_route(procedure_id: int, _: dict = Depends(require_admin_user)) -> Procedure:
    """Restore a soft-deleted procedure."""
    record = database.fetch_procedure(procedure_id, include_deleted=True)
    if not record or not record.get("deleted"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    patient = database.fetch_patient(record["patient_id"], include_deleted=True)
    if not patient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    if patient.get("deleted"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Restore the patient before recovering this procedure.",
        )
    restored = database.restore_procedure(procedure_id)
    if not restored:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Procedure(**restored)


@procedures_router.delete("/{procedure_id}/purge", status_code=status.HTTP_204_NO_CONTENT)
def purge_procedure_route(procedure_id: int, _: dict = Depends(require_admin_user)) -> None:
    """Permanently delete a procedure."""
    record = database.fetch_procedure(procedure_id, include_deleted=True)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    deleted = database.purge_procedure(procedure_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")


@procedures_router.get("/{procedure_id}", response_model=Procedure)
def fetch_procedure_route(procedure_id: int) -> Procedure:
    record = database.fetch_procedure(procedure_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    return Procedure(**record)


@procedures_router.put("/{procedure_id}", response_model=OperationResult)
async def update_procedure_route(
    procedure_id: int,
    payload: ProcedureCreatePayload,
    request: Request,
) -> OperationResult:
    if not database.fetch_patient(payload.patient_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Patient not found")
    existing = database.fetch_procedure(procedure_id, include_deleted=True)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    try:
        updated = database.update_procedure(procedure_id, payload.model_dump(exclude={"patient_id"}))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    refreshed = database.fetch_procedure(procedure_id)
    if refreshed:
        await _emit_procedure_event("updated", refreshed, request)
    return OperationResult(success=True, id=procedure_id, message="Procedure updated")


@procedures_router.delete(
    "/{procedure_id}",
    response_model=OperationResult,
    status_code=status.HTTP_200_OK,
)
async def delete_procedure_route(procedure_id: int, request: Request) -> OperationResult:
    procedure = database.fetch_procedure(procedure_id, include_deleted=True)
    if not procedure:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    deleted = database.delete_procedure(procedure_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found")
    await _emit_procedure_event("deleted", procedure, request)
    return OperationResult(success=True, id=procedure_id)


@procedures_router.post("/search-by-meta", response_model=ProcedureMetadataSearchResponse)
def search_procedure_by_metadata(payload: ProcedureMetadataDeleteRequest) -> ProcedureMetadataSearchResponse:
    """Return a procedure id when metadata matches."""
    provided_filters = [
        (payload.full_name or "").strip(),
        (payload.date or "").strip(),
        (payload.status or "").strip(),
        (payload.grafts_number or "").strip(),
        (payload.package_type or "").strip(),
    ]
    if not any(filter_value for filter_value in provided_filters):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide at least one search field (full_name, date, status, grafts_number, or package_type).",
        )
    patient_id = None
    if payload.full_name:
        patient = database.find_patient_by_full_name(payload.full_name)
        if not patient:
            return ProcedureMetadataSearchResponse(success=False, message="Patient record not found")
        patient_id = patient["id"]
    try:
        match = database.find_procedure_by_metadata(
            patient_id,
            payload.date,
            status=payload.status,
            grafts_number=payload.grafts_number,
            package_type=payload.package_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not match:
        return ProcedureMetadataSearchResponse(success=False, message="Procedure not found")
    return ProcedureMetadataSearchResponse(
        success=True,
        procedure_id=match["id"],
        procedure_date=match.get("procedure_date"),
        status=match.get("status"),
        procedure_type=match.get("procedure_type"),
        package_type=match.get("package_type"),
        agency=match.get("agency"),
        grafts=match.get("grafts"),
    )


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


def _get_casefold_query_param(request: Request, name: str) -> Optional[str]:
    """Return a query parameter value regardless of key casing."""
    desired = name.lower()
    for key, value in request.query_params.multi_items():
        if key.lower() == desired:
            return value
    return None


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


@status_router.get("/activity-feed", response_model=List[ActivityEvent])
def list_activity_feed() -> List[ActivityEvent]:
    """Return the latest activity events for the live feed."""
    records = database.list_activity_events()
    return [ActivityEvent(**record) for record in records]


@search_router.get("/search", response_model=PatientSearchResult, response_model_exclude_none=True)
def search_patients_route(
    request: Request,
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
    if full_name is None:
        full_name = _get_casefold_query_param(request, "full_name")
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
        return PatientSearchResult(success=False, message="Patient record not found", procedures=[])
    patient = Patient(**record)
    patient_data = patient.model_dump()
    procedure_records = database.list_procedures_for_patient(patient.id)
    procedures = [Procedure(**entry) for entry in procedure_records]
    return PatientSearchResult(
        success=True,
        **patient_data,
        procedures=procedures,
    )


# Google Drive Image Proxy Route

@drive_router.get("/{file_id}")
def get_drive_image(file_id: str):
    """
    Proxies a Google Drive image to the frontend using the server's access token.
    This keeps the token private and avoids CORS issues with direct Drive links.
    """
    # Google Drive file download endpoint
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"

    token = get_access_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Google Drive authentication failed. Please reconnect Google Drive in Settings.",
        )
    
    headers = {
        "Authorization": f"Bearer {token}"
    }

    try:
        r = requests.get(url, headers=headers, stream=True)
        if r.status_code != 200:
            detail = r.text or "File not found or no permission"
            raise HTTPException(status_code=r.status_code, detail=detail)
        
        # Auto detect mime type if Google returns it
        content_type = r.headers.get("Content-Type", "image/jpeg")
        
        # If it's a downloadable file, add disposition
        headers = {}
        if "image" not in content_type:
             # Try to get filename from Content-Disposition if available, or just set generic
             cd = r.headers.get("Content-Disposition")
             if cd:
                 headers["Content-Disposition"] = cd
        
        return Response(content=r.content, media_type=content_type, headers=headers)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Drive fetch failed: {e}")


@drive_router.get("/{file_id}/meta")
def get_drive_file_meta(file_id: str):
    """
    Fetches metadata (name, mimeType) for a Drive file.
    """
    url = f"https://www.googleapis.com/drive/v3/files/{file_id}?fields=id,name,mimeType"
    token = get_access_token()
    if not token:
        raise HTTPException(status_code=503, detail="Google Drive authentication failed. Please reconnect Google Drive.")
    
    headers = {"Authorization": f"Bearer {token}"}
    try:
        r = requests.get(url, headers=headers)
        if r.status_code != 200:
            raise HTTPException(status_code=r.status_code, detail=r.text or "Google Drive request failed")
        return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Drive metadata fetch failed: {e}")


@drive_router.get("/folder/{folder_id}/files")
def list_drive_folder_files(folder_id: str):
    """
    Lists all files under a given Drive folder. Uses the server's access token and
    returns id/name/mimeType and the Drive webViewLink when present.
    """
    token = get_access_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Google Drive authentication failed. Please reconnect Google Drive in Settings.",
        )

    headers = {"Authorization": f"Bearer {token}"}
    url = "https://www.googleapis.com/drive/v3/files"

    files: List[dict] = []
    page_token: Optional[str] = None
    params = {
        "q": f"'{folder_id}' in parents and trashed=false",
        "fields": "files(id,name,mimeType,webViewLink,thumbnailLink),nextPageToken",
        "pageSize": 200,
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
    }

    try:
        while True:
            if page_token:
                params["pageToken"] = page_token
            r = requests.get(url, headers=headers, params=params)
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text or "Google Drive request failed")
            data = r.json()
            files.extend(data.get("files", []))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Drive list failed: {e}")

    return {"files": files}


@drive_router.post("/folder/{folder_id}/upload", status_code=status.HTTP_201_CREATED)
async def upload_drive_files(folder_id: str, files: List[UploadFile] = File(...)):
    """
    Uploads one or more files directly into a Drive folder using multipart upload.
    """
    if not files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No files provided")

    token = get_access_token()
    if not token:
        raise HTTPException(
            status_code=503,
            detail="Google Drive authentication failed. Please reconnect Google Drive in Settings.",
        )

    headers = {"Authorization": f"Bearer {token}"}
    upload_url = "https://www.googleapis.com/upload/drive/v3/files"
    params = {
        "uploadType": "multipart",
        "fields": "id,name,mimeType,thumbnailLink,webViewLink",
        "supportsAllDrives": True,
    }

    uploaded: List[dict] = []
    for index, upload in enumerate(files):
        name = upload.filename or f"upload-{index}"
        metadata = {"name": name, "parents": [folder_id]}
        media = await upload.read()
        files_payload = {
            "metadata": ("metadata", json.dumps(metadata), "application/json"),
            "file": (name, media, upload.content_type or "application/octet-stream"),
        }
        try:
            resp = requests.post(upload_url, headers=headers, params=params, files=files_payload)
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=resp.status_code, detail=resp.text or "Drive upload failed")
            uploaded.append(resp.json())
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Drive upload failed: {exc}")

    return {"files": uploaded}
