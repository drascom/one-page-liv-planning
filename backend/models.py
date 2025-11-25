"""Pydantic models representing Liv's weekly planning data."""
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from pydantic import AliasChoices, AliasPath, BaseModel, ConfigDict, Field


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


class PatientCreate(PatientBase):
    pass


class Patient(PatientBase):
    id: int = Field(..., description="Database identifier for the patient")
    deleted: bool = Field(False, description="Whether the record is hidden (soft deleted)")
    created_at: str = Field(..., description="Timestamp when the patient was created")
    updated_at: str = Field(..., description="Timestamp when the patient was last updated")
    photo_count: int = Field(0, description="Number of photo records linked to the patient", ge=0)

    class Config:
        from_attributes = True


class ProcedureBase(BaseModel):
    """Procedure model - contains scheduling and booking metadata."""
    procedure_date: str = Field(..., description="ISO date for the scheduled procedure")
    status: str = Field(..., description="Procedure workflow status")
    procedure_type: str = Field(..., description="Buckets used to filter procedures")
    package_type: Optional[str] = Field(None, description="Package/bundle selection for the procedure")
    agency: Optional[str] = Field(None, description="Agency or referral source for the procedure")
    grafts: str = Field(..., description="Number of grafts or imported numeric detail")
    payment: Optional[str] = Field(None, description="Payment collection status")
    consultation: List[str] = Field(default_factory=list, description="Consultations recorded for the procedure")
    forms: List[str] = Field(default_factory=list, description="Completed form identifiers")
    consents: List[str] = Field(default_factory=list, description="Completed consent identifiers")
    photo_files: List[str] = Field(default_factory=list, description="Relative file paths for uploaded photos")


class ProcedureCreate(ProcedureBase):
    pass


class ProcedureCreatePayload(ProcedureCreate):
    patient_id: int = Field(..., description="Identifier for the patient this procedure belongs to")


class Procedure(ProcedureBase):
    id: int = Field(..., description="Database identifier for the procedure")
    patient_id: int = Field(..., description="Identifier for the patient this procedure belongs to")
    photos: int = Field(0, description="Number of uploaded photos", ge=0)
    deleted: bool = Field(False, description="Whether the record is hidden (soft deleted)")
    created_at: str = Field(..., description="Timestamp when the procedure was created")
    updated_at: str = Field(..., description="Timestamp when the procedure was last updated")

    class Config:
        from_attributes = True


class ProcedureSearchResult(BaseModel):
    success: bool = Field(..., description="Whether a matching procedure was found")
    message: Optional[str] = Field(None, description="Details when the procedure is missing")
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


class PhotoBase(BaseModel):
    """Photo model for patient photos."""
    name: str = Field(..., description="Photo name/description")
    file_path: str = Field(..., description="Relative path to the photo file")
    taken_at: Optional[str] = Field(None, description="When the photo was taken")


class PhotoCreate(PhotoBase):
    pass


class Photo(PhotoBase):
    id: int = Field(..., description="Database identifier for the photo")
    patient_id: int = Field(..., description="Identifier for the patient this photo belongs to")
    created_at: str = Field(..., description="Timestamp when the photo was uploaded")

    class Config:
        from_attributes = True


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


class PatientSearchResult(BaseModel):
    success: bool = Field(..., description="Indicates whether the patient was found")
    id: Optional[int] = Field(None, description="Database identifier for the matching patient")
    surgery_date: Optional[str] = Field(None, description="ISO surgery date (procedure_date in the DB)")
    patient: Optional[Patient] = Field(None, description="Full patient record when a match is found")
    message: Optional[str] = Field(None, description="Human readable message (e.g. when the patient is missing)")


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


class DeletedProcedureRecord(BaseModel):
    procedure: Procedure = Field(..., description="Soft-deleted procedure record")
    patient: Patient = Field(..., description="Patient that owns the procedure")


class FieldOption(BaseModel):
    value: str = Field(..., description="Stored value for the option", min_length=1)
    label: str = Field(..., description="Human-friendly label", min_length=1)


class FieldOptionUpdate(BaseModel):
    options: List[FieldOption]


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
