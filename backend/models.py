"""Pydantic models representing Liv's weekly planning data."""
from __future__ import annotations

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


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
    month_label: str = Field(..., description="Name of the month to display (e.g. June 2024)")
    week_label: str = Field(..., description="Readable label for the week (Week 1)")
    week_range: str = Field(..., description="Date range for the week (Jun 3 – Jun 9)")
    week_order: int = Field(..., description="Sort order for the week block")
    day_label: str = Field(..., description="Day label shown in the schedule (Mon, Tue)")
    day_order: int = Field(..., description="Sort order inside the week")
    first_name: str = Field(..., description="Patient first name")
    last_name: str = Field(..., description="Patient last name")
    email: str = Field(..., description="Preferred contact email")
    phone: str = Field(..., description="Preferred phone number")
    city: str = Field(..., description="Patient city")
    patient_date: Optional[str] = Field(None, description="ISO date for the scheduled procedure")
    status: Literal["reserved", "confirmed", "insurgery", "done"] = Field(
        ..., description="Surgery workflow status"
    )
    surgery_type: Literal["small", "big", "beard", "woman"] = Field(
        ..., description="Buckets used to filter surgeries"
    )
    payment: Literal["waiting", "paid", "partially_paid"] = Field(
        ..., description="Payment collection status"
    )
    forms: List[str] = Field(default_factory=list, description="Completed form identifiers")
    consents: List[str] = Field(default_factory=list, description="Completed consent identifiers")
    photos: int = Field(0, description="Number of uploaded photos", ge=0)
    photo_files: List[str] = Field(default_factory=list, description="Relative file paths for uploaded photos")


class PatientCreate(PatientBase):
    pass


class Patient(PatientBase):
    id: int = Field(..., description="Database identifier for the patient")

    class Config:
        from_attributes = True


class ApiTokenBase(BaseModel):
    name: str = Field(..., description="Friendly name to identify where the token is used")


class ApiTokenCreate(ApiTokenBase):
    pass


class ApiToken(ApiTokenBase):
    id: int = Field(..., description="Database identifier for the token")
    token: str = Field(..., description="Raw token string (store securely)")
    created_at: str = Field(..., description="ISO timestamp when the token was created")

    class Config:
        from_attributes = True
