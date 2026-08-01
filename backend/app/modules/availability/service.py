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
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.recurrence import expand_rrule
from app.modules.models import Booking, Resource, BookingStatus, ResourceType, Event, EventStatus


def _to_utc_naive(dt: datetime) -> datetime:
    """Normalise to naive-UTC so two datetimes are compared by absolute INSTANT,
    never by their string offset (recurring occurrences come back +00:00 but edited
    exception rows come back in server-local +05:30 — same instant, different text)."""
    if dt.tzinfo is not None:
        off = dt.utcoffset()
        if off:
            dt = dt - off
        return dt.replace(tzinfo=None)
    return dt


def _fmt_local(dt: datetime, fmt: str) -> str:
    """Render in the app's pinned wall-clock zone for user-facing conflict messages.
    RRULE occurrences are UTC-aware; showing them raw reads 5h30 off from the calendar.
    Convert aware datetimes to APP_TIMEZONE (pinned, not the server's ambient zone) so
    the message matches what the user sees. Naive values are assumed already-local."""
    try:
        if getattr(dt, "tzinfo", None) is not None:
            try:
                from zoneinfo import ZoneInfo
                from app.core.config import settings
                return dt.astimezone(ZoneInfo(settings.APP_TIMEZONE)).strftime(fmt)
            except Exception:
                return dt.astimezone().strftime(fmt)
        return dt.strftime(fmt)
    except Exception:
        return dt.strftime(fmt)


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

    def _effective_occurrences(self, template: Booking, search_start: datetime, search_end: datetime):
        """The template's REAL busy windows in [start, end), with per-occurrence
        exceptions applied — so availability agrees with the calendar.

        A recurring template stores one RRULE; each generated occurrence can be
        overridden by an exception Event (parent_event_id = the root, keyed by
        occurrence_date). CANCELLED exception → that date is VACATED (free again).
        CONFIRMED exception → the occurrence happens at the exception's OWN time
        (which may be moved). Without this, a cancelled class still marked its room
        busy forever, so the freed slot became un-bookable by anyone."""
        duration = template.end_time - template.start_time
        occ = expand_rrule(
            rrule_string=template.recurrence_rule.rrule,
            dtstart=template.start_time,
            duration=duration,
            search_start=search_start,
            search_end=search_end,
        )
        root_id = template.event_id
        exceptions = self.db.query(Event).filter(Event.parent_event_id == root_id).all() if root_id else []
        if not exceptions:
            return occ

        overridden = {_to_utc_naive(ex.occurrence_date) for ex in exceptions if ex.occurrence_date is not None}

        # WHICH ROOM does each exception actually occupy?
        #   • its own ACTIVE booking      → that room (moved to a different room)
        #   • only a CANCELLED booking    → no room at all ("venue not decided")
        #   • no booking row whatsoever   → inherits THIS template's room
        # Without this, an occurrence moved to another room left the ORIGINAL room
        # falsely busy — the reason per-occurrence room changes were blocked before.
        # An occurrence that owns a booking is accounted for BY that booking (CHECK 1
        # scans raw non-template bookings), so this template must not also count it —
        # otherwise the same occurrence is busy twice and every later edit of it
        # self-conflicts. Occurrences with no row of their own still inherit here.
        owns_booking = set()
        ex_ids = [ex.id for ex in exceptions]
        if ex_ids:
            for bk in self.db.query(Booking).filter(
                Booking.event_id.in_(ex_ids),
                Booking.is_recurring_template == False,  # noqa: E712
            ).all():
                owns_booking.add(bk.event_id)

        def _occupies_this_room(ex):
            return ex.id not in owns_booking

        result = [
            (ex.start_time, ex.end_time)
            for ex in exceptions
            if ex.status != EventStatus.CANCELLED and ex.occurrence_date is not None
            and _occupies_this_room(ex)
            and ex.start_time < search_end and ex.end_time > search_start
        ]
        # keep the RRULE occurrences that no exception has overridden
        result.extend((s, e) for (s, e) in occ if _to_utc_naive(s) not in overridden)
        return result

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

        RACE NOTE: `SELECT ... FOR UPDATE` only locks rows that ALREADY EXIST. When two
        people book the SAME empty slot at the same instant, there are no rows to lock,
        so both pass the check and both inserts succeed — a double-booking. To close that
        gap we take a Postgres *advisory* lock keyed on the resource id before checking.
        Advisory locks don't need a row to exist; concurrent writers on the same resource
        serialise, so the second one sees the first one's committed booking and gets 409.
        The lock is transaction-scoped (`_xact_`) — released automatically on commit/rollback.
        """
        if lock:
            # One writer per resource at a time. hashtext()→int4, widened to bigint for
            # the single-arg advisory-lock overload. Different resources never block.
            self.db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:rid)::bigint)"),
                {"rid": str(resource_id)},
            )
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
            # exception-aware: a cancelled/moved occurrence no longer blocks its slot
            occurrences = [
                (s, e) for (s, e) in self._effective_occurrences(t, start, end)
                if s < end and e > start
            ]
            if occurrences:
                occurrences.sort(key=lambda iv: iv[0])
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
                        f"{_fmt_local(occ_start, '%a, %b %d at %H:%M')}–"
                        f"{_fmt_local(occ_end, '%H:%M')}"
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
            # exception-aware: cancelled occurrences drop out, moved ones shift
            intervals.extend(
                (s, e) for (s, e) in self._effective_occurrences(t, range_start, range_end)
                if s < range_end and e > range_start
            )

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
