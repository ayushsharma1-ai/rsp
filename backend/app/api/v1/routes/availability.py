"""
Availability routes — the READ-only HTTP layer over AvailabilityService.

These endpoints never change data; they just answer "what's free?". That's why none
of them take a database lock (unlike booking creation). Both require a logged-in user,
matching the rest of the API.
"""

from datetime import datetime, date as date_type, time, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user
from app.modules.models import User, ResourceType
from app.modules.availability.service import (
    AvailabilityService, ResourceAvailability, FreeSlotsOut, Interval,
)

router = APIRouter(prefix="/availability", tags=["availability"])


def _utc_day_bounds(d: date_type):
    """Turn a calendar date into [00:00, next-day 00:00) in UTC.

    NOTE (known follow-up): we treat the date as a UTC day for now. For an IST
    campus this can be off near midnight; a later pass will accept a timezone.
    """
    start = datetime.combine(d, time.min, tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


@router.get("/day", response_model=List[ResourceAvailability])
def day_availability(
    date: date_type = Query(..., description="Calendar day to check (YYYY-MM-DD)"),
    resource_type: Optional[ResourceType] = Query(None, description="Optional filter"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Free/busy status of every active resource on `date`.

    Powers the room-list colour dots (`is_free`) and the empty-room search filter.
    """
    day_start, day_end = _utc_day_bounds(date)
    return AvailabilityService(db).day_availability(day_start, day_end, resource_type)


@router.get("/free-slots", response_model=FreeSlotsOut)
def free_slots(
    resource_id: str = Query(...),
    date: date_type = Query(..., description="Day to search (YYYY-MM-DD)"),
    duration_minutes: int = Query(60, ge=15, le=24 * 60),
    from_hour: int = Query(8, ge=0, le=23, description="Working-window start hour (UTC)"),
    to_hour: int = Query(20, ge=1, le=24, description="Working-window end hour (UTC)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open windows on one resource for `date`, at least `duration_minutes` long,
    searched inside the working window [from_hour, to_hour)."""
    if to_hour <= from_hour:
        raise HTTPException(status_code=400, detail="to_hour must be greater than from_hour")

    base = datetime.combine(date, time.min, tzinfo=timezone.utc)
    window_start = base + timedelta(hours=from_hour)
    window_end = base + timedelta(hours=to_hour)

    slots = AvailabilityService(db).free_slots(
        resource_id, window_start, window_end, timedelta(minutes=duration_minutes)
    )
    return FreeSlotsOut(
        resource_id=resource_id,
        free_slots=[Interval(start=s, end=e) for s, e in slots],
    )
