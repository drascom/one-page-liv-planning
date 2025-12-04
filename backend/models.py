"""Pydantic models representing Liv's weekly planning data."""
from __future__ import annotations

from datetime import date, datetime
import secrets
from enum import Enum
from typing import Any, Dict, List, Optional, Union

from pydantic import AliasChoices, AliasPath, BaseModel, ConfigDict, Field, model_validator


class WeeklyPlanBase(BaseModel):
    week_start: date = Field(..., description="ISO week start date (e.g. 2023-09-04)")
    focus_area: str = Field(..., description="Main business focus for the week")
    objectives: str = Field(..., description="Concise bullet-style objectives")
    metrics: Optional[str] = Field(None, description="How success will be measured")
    notes: Optional[str] = Field(None, description="Any blockers or reminders")


class WeeklyPlanCreate(WeeklyPlanBase):
    pass


class WeeklyPlan(WeeklyPlanBase):
    id: int = Field(..., description="Database identifier for the plan")

    class Config:
        from_attributes = True


class PatientBase(BaseModel):
    """Patient model - personal information only."""
    first_name: str = Field(..., description="Patient first name")
    last_name: str = Field(..., description="Patient last name")
    email: str = Field(..., description="Preferred contact email")
    phone: str = Field(..., description="Preferred phone number")
    city: str = Field(..., description="Patient city")
    drive_folder_id: Optional[str] = Field(None, description="The ID of the patient's folder")


class PatientCreate(PatientBase):
    pass


class Patient(PatientBase):
    id: int = Field(..., description="Database identifier for the patient")
    deleted: bool = Field(False, description="Whether the record is hidden (soft deleted)")
    created_at: str = Field(..., description="Timestamp when the patient was created")
    updated_at: str = Field(..., description="Timestamp when the patient was last updated")

    class Config:
        from_attributes = True


class PatientMergeUpdate(BaseModel):
    """Optional fields that can be applied to the surviving patient during a merge."""
    first_name: Optional[str] = Field(None, description="Updated first name for the surviving patient")
    last_name: Optional[str] = Field(None, description="Updated last name for the surviving patient")
    email: Optional[str] = Field(None, description="Updated email for the surviving patient")
    phone: Optional[str] = Field(None, description="Updated phone for the surviving patient")
    city: Optional[str] = Field(None, description="Updated city for the surviving patient")
    drive_folder_id: Optional[str] = Field(None, description="Drive folder to keep on the surviving patient")


class PatientMergeRequest(BaseModel):
    target_patient_id: int = Field(..., description="Patient record to keep after merging duplicates")
    source_patient_ids: List[int] = Field(..., min_length=1, description="Duplicate patient IDs to merge into target")
    updates: Optional[PatientMergeUpdate] = Field(
        None, description="Optional overrides applied to the surviving patient record"
    )


class ProcedureBase(BaseModel):
    """Procedure model - contains scheduling and booking metadata."""
    procedure_date: str = Field(..., description="ISO date for the scheduled procedure")
    status: str = Field(..., description="Procedure workflow status")
    procedure_type: str = Field(..., description="Buckets used to filter procedures")
    package_type: str = Field(..., description="Package/bundle selection for the procedure")
    grafts: float = Field(..., description="Number of grafts or imported numeric detail", ge=0)
    agency: Optional[str] = Field(None, description="Agency or referral source for the procedure")
    payment: Optional[str] = Field(None, description="Payment collection status")
    outstaning_balance: Optional[float] = Field(
        None, description="Outstanding balance remaining for the procedure", ge=0
    )
    consultation: List[str] = Field(default_factory=list, description="Consultations recorded for the procedure")
    forms: List[str] = Field(default_factory=list, description="Completed form identifiers")
    consents: List[str] = Field(default_factory=list, description="Completed consent identifiers")
    notes: List["ProcedureNote"] = Field(default_factory=list, description="To-do style notes for the procedure")


class ProcedureNote(BaseModel):
    """Individual note entry for a procedure."""
    id: str = Field(default_factory=lambda: secrets.token_hex(8), description="Unique note identifier")
    text: str = Field(..., min_length=1, description="Note text/content")
    completed: bool = Field(False, description="Whether the task is completed")
    user_id: Optional[int] = Field(None, description="Author's user ID")
    author: Optional[str] = Field(None, description="Author username")
    created_at: Optional[str] = Field(None, description="Timestamp when the note was created")

    @model_validator(mode="before")
    @classmethod
    def coerce_note(cls, value: Any) -> Dict[str, Any]:
        if isinstance(value, cls):
            return value.model_dump()
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return {}
            return {"text": text}
        if isinstance(value, dict):
            text = value.get("text") or value.get("note") or value.get("value")
            if not text:
                return {}
            return {
                "id": value.get("id") or value.get("_id") or value.get("uuid") or secrets.token_hex(8),
                "text": str(text).strip(),
                "completed": bool(value.get("completed", value.get("done", False))),
                "user_id": value.get("user_id"),
                "author": value.get("author"),
                "created_at": value.get("created_at"),
            }
        return {}


class ProcedureCreate(ProcedureBase):
    pass


class ProcedureCreatePayload(ProcedureCreate):
    patient_id: int = Field(..., description="Identifier for the patient this procedure belongs to")


class Procedure(ProcedureBase):
    id: int = Field(..., description="Database identifier for the procedure")
    patient_id: int = Field(..., description="Identifier for the patient this procedure belongs to")
    deleted: bool = Field(False, description="Whether the record is hidden (soft deleted)")
    created_at: str = Field(..., description="Timestamp when the procedure was created")
    updated_at: str = Field(..., description="Timestamp when the procedure was last updated")

    class Config:
        from_attributes = True


class ProcedureSearchResult(BaseModel):
    success: bool = Field(..., description="Whether a matching procedure was found")
    message: Optional[str] = Field(None, description="Details when the procedure is missing")
    msg: Optional[str] = Field(None, description="Short status message for integrations")
    procedure: Optional[Procedure] = Field(None, description="Matched procedure when success is true")


class ProcedureListResponse(BaseModel):
    success: bool = Field(..., description="Whether any procedures were returned")
    message: Optional[str] = Field(None, description="Helper text when the list is empty")
    procedures: List[Procedure] = Field(default_factory=list, description="Procedures linked to the patient")


class ProcedureMetadataDeleteRequest(BaseModel):
    full_name: Optional[str] = Field(None, description="Patient full name (first and last)")
    date: Optional[str] = Field(None, description="Procedure date string (ISO or YYYY-MM-DD)")
    status: Optional[str] = Field(None, description="Optional workflow status to narrow matching")
    grafts_number: Optional[str] = Field(None, alias="grafts_number", description="Optional graft count string")
    package_type: Optional[str] = Field(None, description="Optional package type identifier")

    class Config:
        populate_by_name = True


class ProcedureMetadataSearchResponse(BaseModel):
    success: bool = Field(..., description="Whether a matching procedure was found")
    procedure_id: Optional[int] = Field(None, description="Identifier of the deleted procedure")
    message: Optional[str] = Field(None, description="Additional details about the operation")
    msg: Optional[str] = Field(None, description="Short status message for integrations")
    full_name: Optional[str] = Field(None, description="Echo of the provided full_name search parameter")
    procedure_date: Optional[str] = Field(None, description="ISO procedure date when a match is found")
    status: Optional[str] = Field(None, description="Workflow status for the procedure")
    procedure_type: Optional[str] = Field(None, description="Procedure type identifier")
    package_type: Optional[str] = Field(None, description="Package selection for the procedure")
    agency: Optional[str] = Field(None, description="Agency or referral source")
    grafts: Optional[float] = Field(None, description="Stored graft count/detail", ge=0)


class PaymentBase(BaseModel):
    """Payment model for patient payments."""
    amount: float = Field(..., description="Payment amount")
    currency: str = Field("GBP", description="Currency code (e.g. GBP, USD)")


class PaymentCreate(PaymentBase):
    pass


class Payment(PaymentBase):
    id: int = Field(..., description="Database identifier for the payment")
    patient_id: int = Field(..., description="Identifier for the patient this payment belongs to")
    created_at: str = Field(..., description="Timestamp when the payment was recorded")

    class Config:
        from_attributes = True


class DataIntegrityIssue(BaseModel):
    issue_type: str = Field(..., description="Classification for the missing/invalid data")
    entity: str = Field(..., description="Entity/table where the issue was detected")
    record_id: Optional[int] = Field(None, description="Primary key of the affected record")
    patient_id: Optional[int] = Field(None, description="Linked patient identifier when available")
    missing_fields: List[str] = Field(default_factory=list, description="Fields that were empty or invalid")
    message: str = Field(..., description="Readable explanation of the issue")


class DataIntegrityReport(BaseModel):
    checked_at: str = Field(..., description="Timestamp when the integrity check ran")
    total_patients: int = Field(..., ge=0, description="Number of patient records scanned")
    total_procedures: int = Field(..., ge=0, description="Number of procedure records scanned")
    issue_count: int = Field(..., ge=0, description="Total number of issues detected")
    truncated: bool = Field(False, description="Whether the reported list was truncated")
    issues: List[DataIntegrityIssue] = Field(default_factory=list, description="Detected issues")


class PatientSearchResult(BaseModel):
    success: bool = Field(..., description="Indicates whether the patient was found")
    message: Optional[str] = Field(None, description="Human readable message (e.g. when the patient is missing)")
    msg: Optional[str] = Field(None, description="Short status message for integrations")
    full_name: Optional[str] = Field(None, description="Echo of the provided full_name search parameter")
    id: Optional[int] = Field(None, description="Database identifier for the matching patient")
    first_name: Optional[str] = Field(None, description="Patient first name when found")
    last_name: Optional[str] = Field(None, description="Patient last name when found")
    email: Optional[str] = Field(None, description="Preferred contact email when found")
    phone: Optional[str] = Field(None, description="Preferred phone number when found")
    city: Optional[str] = Field(None, description="Patient city when found")
    drive_folder_id: Optional[str] = Field(None, description="The ID of the patient's folder")
    deleted: Optional[bool] = Field(None, description="Whether the record is soft deleted")
    created_at: Optional[str] = Field(None, description="Timestamp when the patient was created")
    updated_at: Optional[str] = Field(None, description="Timestamp when the patient was last updated")
    procedures: List[Procedure] = Field(default_factory=list, description="Procedures linked to the patient")


class SimplifiedPatientPayload(BaseModel):
    name: str = Field(
        ...,
        description="Raw full name/description",
        validation_alias=AliasChoices(
            "name",
            AliasPath("body", "procedures", "name"),
            AliasPath("body.procedures", "name"),
        ),
    )
    date: datetime = Field(
        ...,
        description="ISO timestamp supplied by upstream integrations",
        validation_alias=AliasChoices("date", AliasPath("body", "date"), "body.date"),
    )
    status: Optional[str] = Field(
        None,
        description="Workflow status value",
        validation_alias=AliasChoices(
            "status",
            AliasPath("body", "procedures", "status"),
            AliasPath("body.procedures", "status"),
        ),
    )
    surgery_type: Optional[str] = Field(
        None,
        description="Procedure type identifier (R, C, Hair Transplant, etc.)",
        validation_alias=AliasChoices(
            "surgery_type",
            AliasPath("body", "procedures", "surgery_type"),
            AliasPath("body.procedures", "surgery_type"),
        ),
    )
    number: Optional[str] = Field(
        None,
        description="Optional numeric/string detail (payment amount, phone, etc.)",
        validation_alias=AliasChoices(
            "number",
            AliasPath("body", "procedures", "number"),
            AliasPath("body.procedures", "number"),
        ),
    )

    model_config = ConfigDict(populate_by_name=True)


class ApiTokenBase(BaseModel):
    name: str = Field(..., description="Friendly name to identify where the token is used")


class ApiTokenCreate(ApiTokenBase):
    pass


class ApiToken(ApiTokenBase):
    id: int = Field(..., description="Database identifier for the token")
    token: str = Field(..., description="Raw token string (store securely)")
    created_at: str = Field(..., description="ISO timestamp when the token was created")
    user_id: Optional[int] = Field(None, description="Identifier for the user that created the token")

    class Config:
        from_attributes = True


class OperationResult(BaseModel):
    success: bool = Field(..., description="Whether the operation succeeded")
    id: int = Field(..., description="Identifier of the affected record")


class MergePatientsResult(OperationResult):
    archived_patient_ids: List[int] = Field(default_factory=list, description="Patient IDs that were archived")
    moved_procedures: int = Field(0, description="Number of procedures reassigned to the target patient", ge=0)
    moved_payments: int = Field(0, description="Number of payments reassigned to the target patient", ge=0)


class ActivityEvent(BaseModel):
    id: str = Field(..., description="Event identifier (UUID)")
    entity: str = Field(..., description="Entity type represented by the event")
    action: str = Field(..., description="Action that occurred (created, updated, deleted)")
    type: str = Field(..., description="Composite type identifier (entity.action)")
    entityId: Union[str, int, None] = Field(
        None,
        alias="entityId",
        description="Identifier for the entity that was affected",
    )
    summary: str = Field(..., description="Readable summary of the change")
    data: Dict[str, Any] = Field(default_factory=dict, description="Additional structured metadata")
    actor: str = Field(..., description="Actor who triggered the change")
    timestamp: str = Field(..., description="ISO timestamp for when the change occurred")

    model_config = ConfigDict(populate_by_name=True)


class DeletedProcedureRecord(BaseModel):
    procedure: Procedure = Field(..., description="Soft-deleted procedure record")
    patient: Patient = Field(..., description="Patient that owns the procedure")


class FieldOption(BaseModel):
    value: str = Field(..., description="Stored value for the option", min_length=1)
    label: str = Field(..., description="Human-friendly label", min_length=1)


class FieldOptionUpdate(BaseModel):
    options: List[FieldOption]


class N8nImportPayload(BaseModel):
    import_date: date = Field(..., description="ISO date for the n8n import", alias="date")


class LoginRequest(BaseModel):
    username: str
    password: str


class User(BaseModel):
    id: int
    username: str
    is_admin: bool


class UserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False


class UserPasswordUpdate(BaseModel):
    password: str


class UserRoleUpdate(BaseModel):
    is_admin: bool


# Legacy Procedure models - kept for backward compatibility with procedure_bookings table
class ProcedureType(str, Enum):
    HAIR = "hair"
    BEARD = "beard"
    WOMAN = "woman"
    EYEBROW = "eyebrow"


class ProcedureStatus(str, Enum):
    CONSULTATION = "consultation"
    RESERVED = "reserved"
    CONFIRMED = "confirmed"
    IN_SURGERY = "insurgery"
    DONE = "done"


class ProcedureBookingBase(BaseModel):
    patient_id: int = Field(..., description="Foreign key to the patient record")
    type: ProcedureType = Field(..., description="Type of procedure being booked")
    status: ProcedureStatus = Field(..., description="Current workflow status for the booking")
    scheduled_at: Optional[datetime] = Field(None, description="Scheduled start time for the procedure")
    provider: Optional[str] = Field(None, description="Assigned provider or surgeon")
    notes: Optional[str] = Field(None, description="Free-form scheduling notes")


class ProcedureBookingCreate(ProcedureBookingBase):
    pass


class ProcedureBooking(ProcedureBookingBase):
    id: int = Field(..., description="Database identifier for the procedure booking")
    created_at: datetime = Field(..., description="Timestamp when the booking was created")
    updated_at: datetime = Field(..., description="Timestamp when the booking was last updated")

    class Config:
        from_attributes = True

class ChatMessage(BaseModel):
    """Represents a single message in a chat conversation."""
    role: str = Field(..., description="The role of the message sender (e.g., 'user', 'assistant')")
    content: str = Field(..., description="The content of the message")


class ChatHistory(BaseModel):
    """Represents the chat history for a user."""
    id: int = Field(..., description="Database identifier for the chat history")
    user_id: int = Field(..., description="Identifier for the user this chat history belongs to")
    messages: List[ChatMessage] = Field(default_factory=list, description="The list of messages in the conversation")
    created_at: str = Field(..., description="Timestamp when the chat history was created")
    updated_at: str = Field(..., description="Timestamp when the chat history was last updated")

    class Config:
        from_attributes = True

# Ensure forward refs are resolved for models that reference ProcedureNote
ProcedureBase.model_rebuild()
ProcedureCreate.model_rebuild()
ProcedureCreatePayload.model_rebuild()
Procedure.model_rebuild()
