from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user
from app.modules.models import User, BookingStatus
from app.modules.bookings.service import (
    BookingService, EventCreate, EventOut,
    BookingWithDetails, BookingUpdate, EventUpdate
)
from app.modules.bookings.service import (
    BookingService, EventCreate, EventOut,
    BookingWithDetails, BookingUpdate, EventUpdate,
    RecurringEventCreate    # ← add this
)

router          = APIRouter(tags=["bookings"])
events_router   = APIRouter(prefix="/events")
bookings_router = APIRouter(prefix="/bookings")


# ── Events ────────────────────────────────────────────────────

from pydantic import BaseModel as PydanticBase

class CancelOccurrenceRequest(PydanticBase):
    occurrence_date: datetime   # exact datetime of the occurrence to cancel

class EditOccurrenceRequest(PydanticBase):
    occurrence_date: datetime   # which occurrence to edit
    new_start:       datetime   # new start time
    new_end:         datetime   # new end time
    new_title:       str = None
    new_description: str = None

class UpdateEventRequest(PydanticBase):
    start_time:       Optional[datetime] = None
    end_time:         Optional[datetime] = None
    title:            Optional[str]      = None
    description:      Optional[str]      = None
    occurrence_date:  Optional[datetime] = None   # if set → edit one occurrence only

class CancelEventRequest(PydanticBase):
    # Optional — only provided when cancelling one occurrence
    # of a recurring series
    # If None → cancel the entire event or series
    occurrence_date: Optional[datetime] = None

@events_router.post("/{event_id}/cancel-occurrence")
def cancel_occurrence(
    event_id: str,
    data: CancelOccurrenceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).cancel_occurrence(
        root_event_id=event_id,
        occurrence_date=data.occurrence_date,
        actor=current_user,
    )


@events_router.post("/{event_id}/edit-occurrence")
def edit_occurrence(
    event_id: str,
    data: EditOccurrenceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).edit_occurrence(
        root_event_id=event_id,
        occurrence_date=data.occurrence_date,
        new_start=data.new_start,
        new_end=data.new_end,
        actor=current_user,
        new_title=data.new_title,
        new_description=data.new_description,
    )


@events_router.get("", response_model=List[EventOut])
def list_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).list_events(current_user)


@events_router.post("", response_model=EventOut, status_code=201)
def create_event(
    data: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).create_event_with_bookings(data, current_user)

@events_router.post("/recurring", status_code=201)
def create_recurring_event(
    data: RecurringEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).create_recurring_event(
        title=data.title,
        description=data.description,
        rrule_string=data.rrule,
        series_start=data.series_start,
        series_end_date=data.series_end_date,
        duration_minutes=data.duration_minutes,
        resource_id=data.resource_id,
        actor=current_user,
        is_public=data.is_public,
        notes=data.notes,
    )

@events_router.delete("/{event_id}/series")
def delete_series(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete an entire recurring series.
    Only valid for recurring root events.
    For cancelling a single occurrence use POST /{id}/cancel-occurrence.
    For cancelling a one-off event use POST /{id}/cancel.
    """
    return BookingService(db).delete_series(event_id, current_user)


@events_router.get("/calendar")
def calendar_view(
    start: datetime = Query(...),
    end:   datetime = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).get_calendar_events(current_user, start, end)


@events_router.get("/{event_id}")
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).get_event_detail(event_id, current_user)


@events_router.patch("/{event_id}")
def update_event(
    event_id: str,
    data: UpdateEventRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.modules.bookings.service import EventUpdate
    event_data = EventUpdate(
        start_time=data.start_time,
        end_time=data.end_time,
        title=data.title,
        description=data.description,
    )
    return BookingService(db).update_event(
        event_id=event_id,
        data=event_data,
        actor=current_user,
        occurrence_date=data.occurrence_date,
    )


@events_router.post("/{event_id}/cancel")
def cancel_event(
    event_id: str,
    data: CancelEventRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).cancel_event(
        event_id=event_id,
        actor=current_user,
        occurrence_date=data.occurrence_date,
    )


# ── Bookings ──────────────────────────────────────────────────

@bookings_router.get("", response_model=List[BookingWithDetails])
def list_bookings(
    status:      Optional[BookingStatus] = Query(None),
    resource_id: Optional[str]           = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return BookingService(db).list_bookings(current_user, status=status, resource_id=resource_id)


@bookings_router.patch("/{booking_id}/review")
def review_booking(
    booking_id: str,
    new_status: BookingStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    b = BookingService(db).review_booking(booking_id, new_status, current_user)
    return {"id": b.id, "status": b.status.value}


@bookings_router.patch("/{booking_id}/cancel")
def cancel_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    b = BookingService(db).cancel_booking(booking_id, current_user)
    return {"id": b.id, "status": b.status.value}


@bookings_router.patch("/{booking_id}")
def update_booking(
    booking_id: str,
    data: BookingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    b = BookingService(db).update_booking(booking_id, data, current_user)
    return {
        "id":         b.id,
        "status":     b.status.value,
        "start_time": b.start_time.isoformat(),
        "end_time":   b.end_time.isoformat(),
    }


router.include_router(events_router)
router.include_router(bookings_router)
