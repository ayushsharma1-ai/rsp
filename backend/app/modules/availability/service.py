"""
Availability Service
────────────────────
Answers ONE question in several shapes: "is a resource free during a time window?"

WHY THIS MODULE EXISTS
----------------------
Until now, the only code that knew how to detect a booking clash lived *inside*
`bookings/service.py::_create_booking` — and it only ran while WRITING a new booking
(it even takes a database lock, `SELECT ... FOR UPDATE`, so two people can't grab the
same slot at the same instant).

But almost every new feature we want — colour dots on the room list, an empty-room
search, clash previews, free-slot suggestions — needs to *read* availability WITHOUT
writing anything. Reads don't race each other, so they don't need the lock.

So this module becomes the SINGLE SOURCE OF TRUTH for "free or busy?". It serves:
  • the WRITE path → `find_conflict(..., lock=True)`   (booking creation, race-safe)
  • the READ paths → `is_free`, `busy_intervals`, `day_availability`, `free_slots`

Keeping one overlap rule in one place means the "can I book?" answer and the
"is it free?" answer can never drift apart.

THE ONE RULE TO REMEMBER
------------------------
Two time ranges overlap  ⇔  A.start < B.end  AND  A.end > B.start
Everything below is built on that single line.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Tuple

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.recurrence import expand_rrule
from app.modules.models import Booking, Resource, BookingStatus, ResourceType


# A booking in any of these states is a real claim on the room, so it counts as "busy".
# (Exactly the set the old write-path check used, so reads and writes stay in agreement.)
ACTIVE_BOOKING_STATUSES = [
    BookingStatus.CONFIRMED,
    BookingStatus.APPROVED,
    BookingStatus.PENDING,
]


@dataclass
class Conflict:
    """Plain description of why a slot is NOT free — used to build the 409 error text."""
    kind: str           # "one_off" or "recurring"
    start: datetime
    end: datetime
    message: str


# ── Output shapes (what the API hands back as JSON) ──────────────────────────

class Interval(BaseModel):
    start: datetime
    end: datetime


class ResourceAvailability(BaseModel):
    id: str
    name: str
    resource_type: ResourceType
    location: Optional[str] = None
    capacity: Optional[int] = None
    requires_approval: bool
    is_free: bool                 # True = nothing booked in the window → green dot
    busy: List[Interval]          # the booked sub-windows → orange dot / show times


class FreeSlotsOut(BaseModel):
    resource_id: str
    free_slots: List[Interval]


# ── The service ──────────────────────────────────────────────────────────────

class AvailabilityService:
    def __init__(self, db: Session):
        self.db = db

    def _resource_name(self, resource_id: str) -> str:
        """Fetch just the name (only used to build a friendly conflict message)."""
        row = self.db.query(Resource.name).filter(Resource.id == resource_id).first()
        return row[0] if row else resource_id

    # ---- THE SHARED CORE: first clash in a window, or None ------------------
    def find_conflict(
        self,
        resource_id: str,
        start: datetime,
        end: datetime,
        *,
        lock: bool = False,
        exclude_booking_id: Optional[str] = None,
    ) -> Optional[Conflict]:
        """
        Return the FIRST reason `[start, end)` is not free on this resource, or None.

        `lock=True` adds `SELECT ... FOR UPDATE`, locking the matching rows until the
        surrounding transaction finishes. That is what makes booking creation race-safe.
        Read-only callers keep `lock=False` (no lock → faster, never blocks anyone).
        """
        # CHECK 1 — overlap with an existing one-off booking.
        q = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == False,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.start_time < end,      # ┐ the overlap rule:
            Booking.end_time > start,      # ┘ A.start < B.end AND A.end > B.start
        )
        if exclude_booking_id:             # skip the booking being edited (no self-conflict)
            q = q.filter(Booking.id != exclude_booking_id)
        if lock:
            q = q.with_for_update()        # 🔒 only the write path asks for this
        hit = q.first()
        if hit:
            name = self._resource_name(resource_id)
            return Conflict(
                kind="one_off",
                start=hit.start_time,
                end=hit.end_time,
                message=(
                    f"Resource '{name}' is already booked from "
                    f"{hit.start_time.strftime('%b %d, %H:%M')} to "
                    f"{hit.end_time.strftime('%H:%M')}"
                ),
            )

        # CHECK 2 — overlap with a recurring template.
        # Recurring bookings store ONE template row; the real dates are computed at
        # runtime from its RRULE. So we expand each template inside [start, end) and
        # see whether any generated occurrence overlaps the requested window.
        templates_q = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == True,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        )
        if exclude_booking_id:
            templates_q = templates_q.filter(Booking.id != exclude_booking_id)
        templates = templates_q.all()
        for t in templates:
            if not t.recurrence_rule:
                continue
            duration = t.end_time - t.start_time
            occurrences = expand_rrule(
                rrule_string=t.recurrence_rule.rrule,
                dtstart=t.start_time,
                duration=duration,
                search_start=start,
                search_end=end,
            )
            if occurrences:
                occ_start, occ_end = occurrences[0]
                name = self._resource_name(resource_id)
                title = t.event.title if t.event else "Recurring event"
                return Conflict(
                    kind="recurring",
                    start=occ_start,
                    end=occ_end,
                    message=(
                        f"Resource '{name}' has a recurring booking "
                        f"('{title}') that conflicts on "
                        f"{occ_start.strftime('%a, %b %d at %H:%M')}–"
                        f"{occ_end.strftime('%H:%M')}"
                    ),
                )

        return None

    # ---- simple yes/no read -------------------------------------------------
    def is_free(self, resource_id: str, start: datetime, end: datetime) -> bool:
        """True if nothing is booked on this resource during [start, end). No lock."""
        return self.find_conflict(resource_id, start, end, lock=False) is None

    # ---- every busy window in a range (needed for colours & free slots) -----
    def busy_intervals(
        self, resource_id: str, range_start: datetime, range_end: datetime
    ) -> List[Tuple[datetime, datetime]]:
        """
        Every booked (start, end) on this resource overlapping the range — both
        one-off bookings AND expanded occurrences of recurring templates. Sorted.
        """
        intervals: List[Tuple[datetime, datetime]] = []

        one_offs = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == False,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.start_time < range_end,
            Booking.end_time > range_start,
        ).all()
        intervals.extend((b.start_time, b.end_time) for b in one_offs)

        templates = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == True,
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
        ).all()
        for t in templates:
            if not t.recurrence_rule:
                continue
            duration = t.end_time - t.start_time
            intervals.extend(expand_rrule(
                rrule_string=t.recurrence_rule.rrule,
                dtstart=t.start_time,
                duration=duration,
                search_start=range_start,
                search_end=range_end,
            ))

        intervals.sort(key=lambda iv: iv[0])
        return intervals

    # ---- availability of MANY resources for one day (room-list colours) -----
    def day_availability(
        self,
        day_start: datetime,
        day_end: datetime,
        resource_type: Optional[ResourceType] = None,
    ) -> List[ResourceAvailability]:
        q = self.db.query(Resource).filter(Resource.is_active == True)
        if resource_type is not None:
            q = q.filter(Resource.resource_type == resource_type)
        resources = q.order_by(Resource.resource_type, Resource.name).all()

        out: List[ResourceAvailability] = []
        for r in resources:
            # NOTE: one busy query per resource — the classic "N+1" pattern
            # (see DBMS_FOUNDATIONS §11). Fine for a modest room count; if the room
            # list ever grows large, batch all bookings in a single query instead.
            busy = self.busy_intervals(r.id, day_start, day_end)
            out.append(ResourceAvailability(
                id=r.id,
                name=r.name,
                resource_type=r.resource_type,
                location=r.location,
                capacity=r.capacity,
                requires_approval=r.requires_approval,
                is_free=len(busy) == 0,
                busy=[Interval(start=s, end=e) for s, e in busy],
            ))
        return out

    # ---- open gaps that fit a given length (empty-room search) ---------------
    def free_slots(
        self,
        resource_id: str,
        window_start: datetime,
        window_end: datetime,
        duration: timedelta,
    ) -> List[Tuple[datetime, datetime]]:
        """
        Walk the busy intervals and return the GAPS between them (inside the working
        window) that are at least `duration` long. A booked-solid day → empty list.
        """
        busy = self.busy_intervals(resource_id, window_start, window_end)

        free: List[Tuple[datetime, datetime]] = []
        cursor = window_start
        for s, e in busy:
            # clamp this busy interval to our working window
            s = max(s, window_start)
            e = min(e, window_end)
            if s > cursor and (s - cursor) >= duration:   # a big-enough gap before it
                free.append((cursor, s))
            cursor = max(cursor, e)                        # jump past this booking
        if (window_end - cursor) >= duration:             # trailing gap after the last
            free.append((cursor, window_end))
        return free
