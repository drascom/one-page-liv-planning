"""Pydantic models representing Liv's weekly planning data."""
from __future__ import annotations

from datetime import date
from typing import Optional

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
