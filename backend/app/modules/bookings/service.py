"""
BookingService — the most complex domain service.

Key patterns used:
1. FSM (Finite State Machine) for booking status transitions
2. Pessimistic locking (SELECT FOR UPDATE) for conflict detection
3. Event emission for decoupled side effects
4. Transactional consistency: all DB changes in one transaction
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, List
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, text
from pydantic import BaseModel
import json
from app.core.recurrence import check_recurring_conflict, expand_rrule

from app.modules.models import (
    Booking, BookingStatus, Resource, Event, User, AuditLog,
    Notification, NotificationType, EventStatus, EventGroup, EventCategory, EventKind,
    Group,
)
from app.core.events import bus
from app.modules.availability.service import AvailabilityService
from app.modules.clash.service import ClashService


# Master switch for the STUDENT-clash hard block. Turned OFF (2026-06-18) at the
# user's request — student clashes are no longer detected/blocked anywhere. The
# venue-clash + release-request flow is unaffected. Flip back to True to re-enable
# the student-clash block at create + edit (no other change needed).
STUDENT_CLASH_ENABLED = False


# ── Pydantic Schemas ──────────────────────────────────────────
class RecurringEventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    rrule: str                        # e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
    series_start: datetime            # first occurrence start datetime
    series_end_date: datetime         # date when series ends
    duration_minutes: int             # e.g. 60 for a 1-hour lecture
    resource_id: Optional[str] = None
    is_public: bool = True
    notes: Optional[str] = None
    group_ids: List[str] = []          # Fix-4: cohorts this recurring series is for
    event_kind_id: Optional[str] = None   # Class / Workshop / Talk — drives the colour

class BookingCreate(BaseModel):
    resource_id: str
    start_time: datetime
    end_time: datetime
    notes: Optional[str] = None


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    is_public: bool = True
    bookings: List[BookingCreate] = []
    group_ids: List[str] = []          # Phase 2: cohorts/groups this event is for
    category: str = "adhoc"            # Phase 5: 'academic' or 'adhoc'
    color: Optional[str] = None        # legacy per-event hex (superseded by event_kind)
    event_kind_id: Optional[str] = None  # the chosen event type — drives the calendar colour


class EventOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    organizer_id: str
    start_time: datetime
    end_time: datetime
    status: str
    is_public: bool
    created_at: datetime

    class Config:
        from_attributes = True


class BookingOut(BaseModel):
    id: str
    event_id: str
    resource_id: str
    requester_id: str
    start_time: datetime
    end_time: datetime
    status: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class BookingWithDetails(BookingOut):
    resource_name: Optional[str] = None
    event_title: Optional[str] = None
    requester_name: Optional[str] = None
    # A series' TEMPLATE booking cannot have its time edited here (the event editor
    # owns that, with scope). The UI needs to know so it can offer the right action
    # instead of letting the user fill in a form that is refused on save.
    is_recurring_template: bool = False


# ── Valid FSM Transitions ────────────────────────────────────

VALID_TRANSITIONS = {
    BookingStatus.PENDING: {BookingStatus.APPROVED, BookingStatus.REJECTED, BookingStatus.CONFIRMED, BookingStatus.CANCELLED},
    BookingStatus.APPROVED: {BookingStatus.CONFIRMED, BookingStatus.CANCELLED},
    BookingStatus.CONFIRMED: {BookingStatus.CANCELLED},
    BookingStatus.REJECTED: set(),
    BookingStatus.CANCELLED: set(),
}


# ── Service ───────────────────────────────────────────────────

class BookingService:
    def __init__(self, db: Session):
        self.db = db

    def create_event_with_bookings(self, data: EventCreate, actor: User) -> Event:
        """
        Creates an Event and all associated Bookings atomically.
        Each resource is conflict-checked before committing.
        """
        if data.end_time <= data.start_time:
            raise HTTPException(status_code=400, detail="end_time must be after start_time")

        # Block creating events in the past — start must be now or later.
        now = datetime.now(timezone.utc)
        start = data.start_time if data.start_time.tzinfo else data.start_time.replace(tzinfo=timezone.utc)
        if start < now:
            raise HTTPException(status_code=400, detail="Cannot create an event in the past.")

        # Hard block on STUDENT clash (policy 2026-06-10): if this event's groups share any
        # students with another event at the same time, refuse it — pick a different slot.
        if STUDENT_CLASH_ENABLED and data.group_ids:
            resource_ids = [b.resource_id for b in data.bookings]
            for c in ClashService(self.db).find_clashes(
                data.start_time, data.end_time, data.group_ids, resource_ids):
                if c.student_clash:
                    raise HTTPException(
                        status_code=409,
                        detail=(f"Student clash: {c.shared_student_count} student(s) already have "
                                f"'{c.title}' at this time. Pick a different slot."),
                    )

        event = Event(
            title=data.title,
            description=data.description,
            organizer_id=actor.id,
            start_time=data.start_time,
            end_time=data.end_time,
            is_public=data.is_public,
            status=EventStatus.CONFIRMED,
            category=EventCategory(data.category) if data.category in ("academic", "adhoc") else EventCategory.ADHOC,
            color=data.color,
            event_kind_id=data.event_kind_id,
        )
        self.db.add(event)
        self.db.flush()  # get event.id without committing

        # Collect booking notifications and emit them AFTER commit. The event bus is
        # synchronous and each handler opens its OWN fresh DB session; if we publish
        # while the booking is only flushed (not committed), that fresh session can't
        # see the row yet and the handler bails out — so the notification is silently
        # never sent. Publishing post-commit guarantees the row is visible.
        pending_pub = []
        for b in data.bookings:
            self._create_booking(event, b, actor, pending_pub)

        # Phase 2: link this event to the groups (cohorts) it targets, so clash
        # detection can expand event -> groups -> people later.
        for group_id in (data.group_ids or []):
            self.db.add(EventGroup(event_id=event.id, group_id=group_id))

        self._audit(actor, "event.created", "Event", event.id, None,
                    {"title": data.title, "start_time": str(data.start_time)})
        self.db.commit()
        self.db.refresh(event)
        bus.publish("event.created", {"event_id": event.id, "actor_id": actor.id})
        for _name, _payload in pending_pub:
            bus.publish(_name, _payload)
        return event

    def _create_booking(self, event: Event, data: BookingCreate, actor: User,
                        pending_pub: Optional[list] = None) -> Booking:
        """
        Core conflict detection using SELECT FOR UPDATE.

        Why SELECT FOR UPDATE?
        - Prevents two concurrent requests from both seeing "no conflict"
          and both inserting overlapping bookings.
        - The FOR UPDATE lock on the conflicting rows forces the second
          transaction to wait until the first commits or rolls back.
        - PostgreSQL EXCLUDE constraints with tsrange are the production-grade
          solution but require raw SQL migrations.
        """
        resource = self.db.query(Resource).filter(
            Resource.id == data.resource_id,
            Resource.is_active == True
        ).first()
        if not resource:
            raise HTTPException(status_code=404, detail=f"Resource {data.resource_id} not found")

        # Conflict detection now lives in AvailabilityService, so this WRITE path and
        # every READ path (room colours, search, free-slots) share ONE overlap rule.
        # lock=True keeps the race protection (SELECT ... FOR UPDATE) for creation.
        conflict = AvailabilityService(self.db).find_conflict(
            data.resource_id, data.start_time, data.end_time, lock=True
        )
        if conflict:
            raise HTTPException(status_code=409, detail=conflict.message)

        # Determine initial status based on resource policy
        initial_status = (
            BookingStatus.PENDING if resource.requires_approval
            else BookingStatus.CONFIRMED
        )

        booking = Booking(
            event_id=event.id,
            resource_id=data.resource_id,
            requester_id=actor.id,
            start_time=data.start_time,
            end_time=data.end_time,
            status=initial_status,
            notes=data.notes,
        )
        self.db.add(booking)
        self.db.flush()

        # Defer the notification until the caller has committed (see note in
        # create_event_with_bookings). booking.id is a client-side UUID, available
        # right after flush, so we can capture the payload now and publish later.
        event_name = "booking.pending" if resource.requires_approval else "booking.confirmed"
        payload = {
            "booking_id": booking.id,
            "resource_name": resource.name,
            "actor_id": actor.id,
        }
        if pending_pub is not None:
            pending_pub.append((event_name, payload))
        else:
            # Legacy path (no deferral list supplied): publish inline. Safe only when
            # the caller commits before this returns; kept for backward compatibility.
            bus.publish(event_name, payload)

        return booking

    def list_bookings(
        self,
        actor: User,
        status: Optional[BookingStatus] = None,
        resource_id: Optional[str] = None,
    ) -> List[BookingWithDetails]:
        """
        Admins see all bookings; others see only their own.
        This is where ABAC would later replace simple role checks.
        """
        from app.modules.models import UserRole
        q = self.db.query(Booking, Resource, Event, User).join(
            Resource, Booking.resource_id == Resource.id
        ).join(
            Event, Booking.event_id == Event.id
        ).join(
            User, Booking.requester_id == User.id
        )

        if actor.role != UserRole.ADMIN:
            q = q.filter(Booking.requester_id == actor.id)

        if status:
            q = q.filter(Booking.status == status)
        if resource_id:
            q = q.filter(Booking.resource_id == resource_id)

        results = q.order_by(Booking.created_at.desc()).all()
        out = []
        for booking, resource, event, user in results:
            b = BookingWithDetails(
                id=booking.id,
                event_id=booking.event_id,
                resource_id=booking.resource_id,
                requester_id=booking.requester_id,
                start_time=booking.start_time,
                end_time=booking.end_time,
                status=booking.status.value,
                notes=booking.notes,
                created_at=booking.created_at,
                resource_name=resource.name,
                event_title=event.title,
                requester_name=user.full_name,
                is_recurring_template=bool(booking.is_recurring_template),
            )
            out.append(b)
        return out

    def get_calendar_events(self, actor: User, start: datetime, end: datetime) -> List[dict]:
        """Returns events in a date range for calendar display."""
        from app.modules.models import UserRole
        q = self.db.query(Event).filter(
            Event.start_time >= start,
            Event.start_time <= end,
            Event.status != EventStatus.CANCELLED,
        )
        if actor.role != UserRole.ADMIN:
            q = q.filter(
                or_(Event.organizer_id == actor.id, Event.is_public == True)
            )
        events = q.order_by(Event.start_time).all()
        return [
            {
                "id": e.id,
                "title": e.title,
                "start": e.start_time.isoformat(),
                "end": e.end_time.isoformat(),
                "status": e.status.value,
                "is_mine": e.organizer_id == actor.id,
                "organizer_id": e.organizer_id,
            }
            for e in events
        ]

    def review_booking(self, booking_id: str, new_status: BookingStatus, actor: User) -> Booking:
        """
        Approve or reject a pending booking.
        Enforces FSM — invalid transitions raise 400.
        """
        from app.modules.models import UserRole
        booking = self.db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")

        if actor.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Only admins can review bookings")

        if new_status not in VALID_TRANSITIONS.get(booking.status, set()):
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from {booking.status.value} to {new_status.value}"
            )

        old_status = booking.status
        booking.status = new_status
        booking.reviewed_by_id = actor.id
        from datetime import timezone
        booking.reviewed_at = datetime.now(timezone.utc)

        self._audit(actor, f"booking.{new_status.value}", "Booking", booking_id,
                    {"status": old_status.value}, {"status": new_status.value})
        self.db.commit()
        self.db.refresh(booking)

        event_name = f"booking.{new_status.value}"
        bus.publish(event_name, {
            "booking_id": booking.id,
            "requester_id": booking.requester_id,
            "actor_id": actor.id,
        })
        return booking

    def cancel_booking(self, booking_id: str, actor: User) -> Booking:
        from app.modules.models import UserRole
        booking = self.db.query(Booking).filter(Booking.id == booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")

        if actor.role != UserRole.ADMIN and booking.requester_id != actor.id:
            raise HTTPException(status_code=403, detail="Not authorized")

        if BookingStatus.CANCELLED not in VALID_TRANSITIONS.get(booking.status, set()):
            raise HTTPException(status_code=400, detail=f"Cannot cancel a {booking.status.value} booking")

        booking.status = BookingStatus.CANCELLED
        self._audit(actor, "booking.cancelled", "Booking", booking_id, None, None)
        self.db.commit()
        self.db.refresh(booking)
        bus.publish("booking.cancelled", {"booking_id": booking.id, "actor_id": actor.id})
        return booking

    def list_events(self, actor: User) -> List[Event]:
        from app.modules.models import UserRole
        q = self.db.query(Event).filter(Event.status != EventStatus.CANCELLED)
        if actor.role != UserRole.ADMIN:
            q = q.filter(
                or_(Event.organizer_id == actor.id, Event.is_public == True)
            )
        return q.order_by(Event.start_time.desc()).limit(100).all()

    def create_recurring_event(
        self,
        title: str,
        description: Optional[str],
        rrule_string: str,
        series_start: datetime,    # first occurrence start (e.g. 2025-01-06 09:00)
        series_end_date: datetime, # when the series ends (e.g. 2025-05-30)
        duration_minutes: int,     # how long each occurrence is
        resource_id: Optional[str],
        actor: 'User',
        is_public: bool = True,
        notes: Optional[str] = None,
        group_ids: Optional[List[str]] = None,
        event_kind_id: Optional[str] = None,   # Class / Workshop / Talk — drives the colour
    ) -> dict:
        """
        Creates a recurring event series.

        What gets stored:
        1. One RecurrenceRule row with the RRULE string
        2. One Event row (the root/template)
        3. One Booking row (template, not a real occurrence)
            — only if resource_id is provided

        What does NOT get stored:
        Individual occurrence rows — these are generated at runtime.

        The booking template's start_time/end_time represent
        the FIRST occurrence only. Duration is stored implicitly
        as end_time - start_time. All future occurrences are
        computed from the RRULE + this duration.
        """
        from app.modules.models import RecurrenceRule, EventStatus

        # A zero or negative duration makes every occurrence degenerate (end <= start),
        # which slips past overlap checks and renders as a zero-height calendar block.
        if duration_minutes is None or duration_minutes <= 0:
            raise HTTPException(status_code=400,
                                detail="Each occurrence must be at least 1 minute long.")

        duration = timedelta(minutes=duration_minutes)
        from datetime import timezone as tz
        series_end_dt = datetime(
            year=series_end_date.year,
            month=series_end_date.month,
            day=series_end_date.day,
            hour=23, minute=59, second=59,
            tzinfo=tz.utc
        )

        # Build the full RRULE with UNTIL so expansion has a hard stop
        # If the user already included UNTIL or COUNT we don't add it again
        full_rrule = rrule_string
        if 'UNTIL' not in rrule_string.upper() and 'COUNT' not in rrule_string.upper():
            until_str = series_end_dt.strftime('%Y%m%dT%H%M%SZ')
            full_rrule = f"{rrule_string};UNTIL={until_str}"

        # Validate the RRULE generates at least one occurrence
        from app.core.recurrence import expand_rrule
        test_occurrences = expand_rrule(
            rrule_string=full_rrule,
            dtstart=series_start,
            duration=duration,
            search_start=series_start,
            search_end=series_end_dt,
        )
        if not test_occurrences:
            raise HTTPException(
                status_code=400,
                detail="The recurrence rule generates no occurrences in the given date range. "
                    "Check your RRULE string and date range."
            )

        # 1. Create the RecurrenceRule row
        rule_row = RecurrenceRule(
            rrule=full_rrule,
            start_date=series_start,
            end_date=series_end_dt,
        )
        self.db.add(rule_row)
        self.db.flush()   # get rule_row.id

        # 2. Create the root Event row
        first_end = series_start + duration
        event = Event(
            title=title,
            description=description,
            organizer_id=actor.id,
            start_time=series_start,
            end_time=first_end,
            status=EventStatus.CONFIRMED,
            recurrence_rule_id=rule_row.id,
            is_recurring_root=True,
            is_public=is_public,
            event_kind_id=event_kind_id,
        )
        self.db.add(event)
        self.db.flush()   # get event.id

        # Fix-4: link the recurring event to its target groups (for student-clash detection)
        for group_id in (group_ids or []):
            self.db.add(EventGroup(event_id=event.id, group_id=group_id))

        booking_template = None

        # 3. Create the booking template (if resource requested)
        if resource_id:
            resource = self.db.query(Resource).filter(
                Resource.id == resource_id,
                Resource.is_active == True,
            ).first()
            if not resource:
                raise HTTPException(status_code=404, detail="Resource not found")

            # Check every generated occurrence against the room's schedule
            # (one-off + other recurring), via the shared helper used by edit too.
            conflict_msg = self._recurring_series_conflicts(
                resource_id, test_occurrences, series_start, series_end_dt
            )
            if conflict_msg:
                raise HTTPException(status_code=409, detail=conflict_msg)

            # All clear — create the template booking
            initial_status = (
                BookingStatus.PENDING if resource.requires_approval
                else BookingStatus.CONFIRMED
            )
            booking_template = Booking(
                event_id=event.id,
                resource_id=resource_id,
                requester_id=actor.id,
                start_time=series_start,       # first occurrence start
                end_time=first_end,            # first occurrence end
                status=initial_status,
                notes=notes,
                is_recurring_template=True,
                recurrence_rule_id=rule_row.id,
            )
            self.db.add(booking_template)
            self.db.flush()  # populate booking_template.id before we capture it below

        self._audit(actor, "recurring_event.created", "Event", event.id, None, {
            "title": title,
            "rrule": full_rrule,
            "occurrences_count": len(test_occurrences),
        })

        # Capture notification payloads BEFORE commit (ids/status are live now; after
        # commit the objects expire). Publish AFTER commit so each handler's fresh
        # session can see the committed rows. Previously recurring creation published
        # nothing at all — no "new event" broadcast to faculty, no template-booking
        # notification to the organiser. Now it matches one-off create.
        pending_pub = [("event.created", {"event_id": event.id, "actor_id": actor.id})]
        if booking_template is not None:
            _bname = ("booking.pending" if booking_template.status == BookingStatus.PENDING
                      else "booking.confirmed")
            pending_pub.append((_bname, {
                "booking_id": booking_template.id,
                "resource_name": resource.name,
                "actor_id": actor.id,
            }))

        self.db.commit()
        for _name, _payload in pending_pub:
            bus.publish(_name, _payload)

        return {
            "event_id":          event.id,
            "rule_id":           rule_row.id,
            "title":             title,
            "rrule":             full_rrule,
            "first_occurrence":  series_start.isoformat(),
            "last_occurrence":   test_occurrences[-1][0].isoformat() if test_occurrences else None,
            "total_occurrences": len(test_occurrences),
            "resource_id":       resource_id,
            "booking_status":    booking_template.status.value if booking_template else None,
        }

    def _recurring_series_conflicts(self, resource_id, occurrences, window_start, window_end,
                                    exclude_template_id=None, exclude_root_id=None):
        """
        Does a recurring series clash with anything already in this room's schedule?

        `occurrences` = the (start, end) slots the series generates in
        [window_start, window_end]. We check each slot against:
          (a) existing one-off bookings, and
          (b) other recurring templates (expanded via their own rule).
        Returns a ready-to-show 409 message, or None if all clear.
        `exclude_template_id` skips the series' OWN template (used when editing it).
        `exclude_root_id` additionally skips bookings owned by that series' EXCEPTION
        events. An exception's booking is not a template, so it landed in check (a) and
        the series collided with its own moved occurrence: moving a series into room B
        was refused with a 409 naming a booking that was the user's own, and no edit
        could ever succeed.

        Same race guard as `find_conflict(lock=True)`: an advisory lock keyed on the
        resource serialises concurrent writers on this room, so two people creating
        overlapping series in the same instant can't both slip past the check. This helper
        is only ever called on a write path (create/edit series), so locking is always safe.
        """
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:rid)::bigint)"),
            {"rid": str(resource_id)},
        )
        active = [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.PENDING]

        # (a) vs one-off bookings overlapping the series window
        own_q = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == False,
            Booking.status.in_(active),
            Booking.start_time < window_end,
            Booking.end_time > window_start,
        )
        if exclude_root_id:
            family = [exclude_root_id] + [
                e.id for e in self.db.query(Event).filter(
                    Event.parent_event_id == exclude_root_id).all()
            ]
            own_q = own_q.filter(Booking.event_id.notin_(family))
        oneoffs = own_q.all()
        for occ_s, occ_e in occurrences:
            for ex in oneoffs:
                if ex.start_time < occ_e and ex.end_time > occ_s:
                    return (f"Clashes with a booking on "
                            f"{_fmt_local(occ_s, '%a, %b %d at %H:%M')}.")

        # (b) vs other recurring templates on the same resource — exception-aware,
        # so a cancelled/moved occurrence of the other series doesn't phantom-clash.
        others_q = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == True,
            Booking.status.in_(active),
        )
        if exclude_template_id:
            others_q = others_q.filter(Booking.id != exclude_template_id)
        av = AvailabilityService(self.db)
        for other in others_q.all():
            if not other.recurrence_rule:
                continue
            for os2, oe2 in av._effective_occurrences(other, window_start, window_end):
                for occ_s, occ_e in occurrences:
                    if os2 < occ_e and oe2 > occ_s:
                        return (f"Recurring series conflicts with another recurring booking on "
                                f"{_fmt_local(os2, '%a, %b %d at %H:%M')}.")
        return None

    def _audit(self, actor, action, entity_type, entity_id, old, new):
        log = AuditLog(
            actor_id=actor.id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            old_values=json.dumps(old, default=str) if old else None,
            new_values=json.dumps(new, default=str) if new else None,
        )
        self.db.add(log)

def _utc_naive(dt):
    """Strip to naive-UTC so datetimes compare by absolute INSTANT, not by the
    string offset they happen to carry (+00:00 vs +05:30 are the same moment)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        off = dt.utcoffset()
        if off:
            dt = dt - off
        return dt.replace(tzinfo=None)
    return dt


def _app_tz():
    """The pinned display zone (settings.APP_TIMEZONE, default Asia/Kolkata). Falls
    back to the process-local zone if the name can't be resolved."""
    try:
        from zoneinfo import ZoneInfo
        from app.core.config import settings
        return ZoneInfo(settings.APP_TIMEZONE)
    except Exception:
        return None


def _fmt_local(dt, fmt):
    """Format a datetime in the app's pinned wall-clock zone for user-facing messages.

    RRULE occurrences come back UTC-aware (+00:00) while the DB stores naive
    server-local. If we strftime the UTC-aware value directly the message reads 5h30
    earlier than what the user sees on the calendar. We convert aware datetimes to
    APP_TIMEZONE (pinned, not the server's ambient zone) so the string is correct even
    if the host runs in UTC. Naive values are assumed already-local and shown as-is."""
    try:
        if getattr(dt, "tzinfo", None) is not None:
            tz = _app_tz()
            return (dt.astimezone(tz) if tz else dt.astimezone()).strftime(fmt)
        return dt.strftime(fmt)
    except Exception:
        return dt.strftime(fmt)


def _snap_occurrence_instant(root, target, tolerance=timedelta(hours=12), db=None):
    """Resolve `target` to the TRUE occurrence anchor of `root`.

    Callers pass an occurrence datetime that can be off by a few minutes (the UI's
    30-min snapping + local↔UTC re-encoding), in a different offset, OR the MOVED
    time of an occurrence that was already rescheduled. The calendar keys an
    occurrence by its ORIGINAL RRULE instant (the exception's occurrence_date), so:
      1. if `target` matches an existing exception's current start_time, the anchor
         is that exception's occurrence_date (the occurrence was moved to `target`);
      2. otherwise snap to the nearest generated RRULE instant within `tolerance`.
    Returns None when `target` lands on no occurrence of this series (e.g. wrong
    day) so the caller can 400 instead of silently no-op'ing."""
    # (1) target is a previously-moved occurrence's current time → use its anchor
    if db is not None:
        from app.modules.models import Event as _Ev
        tn = _utc_naive(target)
        for ex in db.query(_Ev).filter(_Ev.parent_event_id == root.id).all():
            if ex.occurrence_date is not None and ex.start_time is not None and _utc_naive(ex.start_time) == tn:
                return ex.occurrence_date
    rule = getattr(root, 'recurrence_rule', None)
    if not rule:
        return None
    duration = root.end_time - root.start_time
    occ = expand_rrule(
        rrule_string=rule.rrule,
        dtstart=root.start_time,
        duration=duration,
        search_start=target - timedelta(days=2),
        search_end=target + timedelta(days=2),
    )
    tn = _utc_naive(target)
    best, best_gap = None, None
    for (s, _e) in occ:
        gap = abs(_utc_naive(s) - tn)
        if best_gap is None or gap < best_gap:
            best, best_gap = s, gap
    return best if (best is not None and best_gap <= tolerance) else None


def _cancel_occurrence(self, root_event_id: str, occurrence_date: datetime, actor: 'User') -> dict:
    """
    Cancels a single occurrence of a recurring event.

    What this does NOT do:
    - Does not touch the root event row
    - Does not touch the recurrence rule
    - Does not affect any other occurrence

    What this DOES do:
    - Creates one new Event row (the exception)
        with status=CANCELLED and parent_event_id pointing to root
    - The calendar will see this exception and suppress
        the RRULE-generated occurrence for that date

    occurrence_date: the datetime that the RRULE would have generated
                    for the occurrence being cancelled.
                    e.g. 2026-08-17 10:30:00 UTC for a Monday lecture
    """
    from app.modules.models import UserRole, EventStatus

    # Step 1 — fetch the root event
    # This is a standard SQLAlchemy query:
    # SELECT * FROM events WHERE id = :root_event_id LIMIT 1
    root = self.db.query(Event).filter(Event.id == root_event_id).first()

    if not root:
        raise HTTPException(status_code=404, detail="Event not found")

    # Step 2 — permission check
    # Only the organizer or an admin can cancel occurrences
    if actor.role != UserRole.ADMIN and root.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Step 3 — confirm this is actually a recurring root
    # Cancelling an occurrence only makes sense on recurring series
    if not root.is_recurring_root:
        raise HTTPException(
            status_code=400,
            detail="This event is not a recurring series. "
                "Use cancel_event to cancel a one-off event."
        )

    # Step 3b — resolve to the true occurrence anchor (handles off-by-minutes AND a
    # previously-moved occurrence whose contested time is its moved slot).
    snapped = _snap_occurrence_instant(root, occurrence_date, db=self.db)
    if snapped is None:
        raise HTTPException(status_code=400, detail="That date isn't an occurrence of this series.")
    occurrence_date = snapped

    # Step 4 — check if an exception already exists for this date
    # We don't want two exception rows for the same occurrence
    # SELECT * FROM events
    # WHERE parent_event_id = :root_event_id
    # AND occurrence_date = :occurrence_date
    existing_exception = self.db.query(Event).filter(
        Event.parent_event_id == root_event_id,
        Event.occurrence_date == occurrence_date,
    ).first()

    if existing_exception:
        # Exception already exists — just mark it cancelled
        # (it might have been an edit exception before)
        existing_exception.status = EventStatus.CANCELLED
        # If this occurrence had been moved to its OWN room, release that room too —
        # otherwise a cancelled class would keep its private room booked forever.
        for _own in self.db.query(Booking).filter(
            Booking.event_id == existing_exception.id,
            Booking.is_recurring_template == False,   # noqa: E712
        ).all():
            _own.status = BookingStatus.CANCELLED
        self.db.commit()
        return {
            "message":         "Occurrence cancelled",
            "occurrence_date": occurrence_date.isoformat(),
            "exception_id":    existing_exception.id,
        }

    # Step 5 — create the exception row
    # This is a new Event row, not a new booking
    # The occurrence_date tells the calendar:
    # "suppress the RRULE occurrence at this datetime"
    exception_event = Event(
        title=root.title,                    # same title as root
        description=root.description,
        organizer_id=root.organizer_id,
        start_time=occurrence_date,          # start = the original slot time
        end_time=occurrence_date + (root.end_time - root.start_time),  # same duration
        status=EventStatus.CANCELLED,        # key: this occurrence is cancelled
        parent_event_id=root_event_id,       # points back to the root
        occurrence_date=occurrence_date,     # which RRULE occurrence this replaces
        is_public=root.is_public,
        is_recurring_root=False,             # this is NOT a new series
        recurrence_rule_id=None,             # no rule — it's a one-off exception
    )
    self.db.add(exception_event)

    # Step 6 — audit log
    self._audit(actor, "occurrence.cancelled", "Event", root_event_id, None, {
        "occurrence_date": occurrence_date.isoformat(),
    })

    self.db.commit()

    return {
        "message":         "Occurrence cancelled",
        "occurrence_date": occurrence_date.isoformat(),
        "exception_id":    exception_event.id,
    }






# "caller didn't mention the room" — distinct from "caller asked for NO room" (None).
_UNSET = object()


def _occurrence_room_of(self, exc_event, tmpl_room):
    """Which room does an existing exception occupy?

    An exception carries its OWN (non-template) Booking only when its room was
    customised: an ACTIVE one names the room it moved to, a CANCELLED one is the
    marker for "explicitly no room". No booking row at all → it simply inherits the
    series' room. Returns the resource id, or None for room-less."""
    if exc_event is None:
        return tmpl_room
    own = self.db.query(Booking).filter(
        Booking.event_id == exc_event.id,
        Booking.is_recurring_template == False,   # noqa: E712
    ).order_by(Booking.created_at.desc()).first()
    if own is None:
        return tmpl_room
    return own.resource_id if own.status in (
        BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.PENDING) else None


def _apply_occurrence_room(self, exc_event, target_room, tmpl_room, new_start, new_end, organizer_id):
    """Give ONE occurrence its own room (or take it away), without touching the series.

    The occurrence's room lives on a private Booking attached to the exception row:
      • target == the series' room → delete the override, go back to inheriting
      • target is None            → keep a CANCELLED booking as the "no room" marker
      • target is another room    → an ACTIVE booking on that room
    Availability and clash detection both read this back via the same rule, so the
    ORIGINAL room is genuinely freed for that date and the new one genuinely taken."""
    own = self.db.query(Booking).filter(
        Booking.event_id == exc_event.id,
        Booking.is_recurring_template == False,   # noqa: E712
    ).first()

    # NEVER hard-delete a booking. notifications.related_booking_id and
    # slot_release_requests.booking_id both reference it with no ON DELETE, so a
    # delete blows up at commit with a ForeignKeyViolation (HTTP 500) and loses the
    # whole edit. Once an occurrence has its own booking row it KEEPS it; the row's
    # room and status carry the meaning instead.
    if target_room is None:
        # explicitly room-less — a CANCELLED row is the marker
        if own is None:
            if tmpl_room is None:
                return                      # series has no room either: nothing to mark
            self.db.add(Booking(
                event_id=exc_event.id, resource_id=tmpl_room, requester_id=organizer_id,
                start_time=new_start, end_time=new_end, status=BookingStatus.CANCELLED))
        else:
            own.status = BookingStatus.CANCELLED
        return

    room = self.db.query(Resource).filter(
        Resource.id == target_room, Resource.is_active == True,  # noqa: E712
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    status = BookingStatus.PENDING if room.requires_approval else BookingStatus.CONFIRMED
    if own is None:
        # Back to the series room and never customised before → leave it inheriting,
        # so we don't create a redundant row for the common case.
        if target_room == tmpl_room:
            return
        self.db.add(Booking(
            event_id=exc_event.id, resource_id=room.id, requester_id=organizer_id,
            start_time=new_start, end_time=new_end, status=status))
    else:
        # Already has its own row — repoint it (even back to the series room) rather
        # than deleting. The row is this occurrence's single source of truth.
        own.resource_id = room.id
        own.start_time = new_start
        own.end_time = new_end
        own.status = status


BookingService._occurrence_room_of = _occurrence_room_of
BookingService._apply_occurrence_room = _apply_occurrence_room


def _edit_occurrence(
    self,
    root_event_id:   str,
    occurrence_date: datetime,   # which occurrence to edit (original slot)
    new_start:       datetime,   # new start time
    new_end:         datetime,   # new end time
    actor:           'User',
    new_title:       str = None,
    new_description: str = None,
    new_event_kind_id: str = None,   # change this occurrence's type/colour
    new_resource_id=_UNSET,          # change THIS occurrence's room (None = no room)
) -> dict:
    """
    Edits a single occurrence of a recurring event.

    Creates an exception row with:
    - parent_event_id = root event id  (links back to series)
    - occurrence_date = original slot  (identifies which occurrence)
    - start_time/end_time = new times  (the actual change)
    - status = CONFIRMED               (it still happens, just different)

    The calendar will:
    1. Generate occurrence at occurrence_date from RRULE
    2. Find this exception row for that date
    3. Suppress the generated occurrence
    4. Show this exception row instead (at new_start/new_end)
    """
    from app.modules.models import UserRole, EventStatus

    # Step 1 — fetch and validate root event
    root = self.db.query(Event).filter(Event.id == root_event_id).first()

    if not root:
        raise HTTPException(status_code=404, detail="Event not found")

    if actor.role != UserRole.ADMIN and root.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not root.is_recurring_root:
        raise HTTPException(status_code=400, detail="Not a recurring event series")

    # Resolve to the true occurrence anchor (off-by-minutes OR a re-edit of an
    # already-moved occurrence, whose target is its moved slot).
    snapped = _snap_occurrence_instant(root, occurrence_date, db=self.db)
    if snapped is None:
        raise HTTPException(status_code=400, detail="That date isn't an occurrence of this series.")
    occurrence_date = snapped

    # Step 2 — validate the new times
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    # Don't let a still-upcoming occurrence be moved into the past. Allow editing an
    # already-past occurrence (its original slot is before now) so records can be fixed.
    _now = _utc_naive(datetime.now(timezone.utc))
    if _utc_naive(new_start) < _now and _utc_naive(occurrence_date) >= _now:
        raise HTTPException(status_code=400, detail="Can't move an occurrence into the past.")

    # Step 3 — check for booking conflicts at the new time
    # The root event has a recurring template booking
    # We need to check if the new time conflicts with anything else
    # We skip the root event's own template (same resource, same series)
    # because the original slot will be suppressed anyway
    # PENDING counts: a room with requires_approval=True holds its series template as
    # PENDING, and that booking still claims the room (every other query here treats
    # PENDING as active). Omitting it made template_booking None, so tmpl_room was
    # None, so target_room was None — and the conflict check below was skipped
    # ENTIRELY. Editing one occurrence of a class in an approval-required room could
    # therefore be dropped straight on top of someone else's booking with a 200.
    template_booking = self.db.query(Booking).filter(
        Booking.event_id == root_event_id,
        Booking.is_recurring_template == True,
        Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.APPROVED,
                            BookingStatus.PENDING]),
    ).first()

    # Which room will this occurrence occupy AFTER the edit? Not necessarily the
    # series' room any more — a single occurrence can be moved to its own room.
    tmpl_room = template_booking.resource_id if template_booking else None
    prior_exc = self.db.query(Event).filter(
        Event.parent_event_id == root_event_id,
        Event.occurrence_date == occurrence_date,
    ).first()
    target_room = (self._occurrence_room_of(prior_exc, tmpl_room)
                   if new_resource_id is _UNSET else new_resource_id)

    if target_room:
        # Use the shared, exception-aware conflict engine so the new time is checked
        # against BOTH one-off bookings AND other recurring series (the hand-rolled
        # query here only saw one-offs, so moving one occurrence onto another
        # recurring series' slot silently double-booked the room).
        # Exclude the booking that IS this occurrence in that room, so a same-slot
        # edit never self-conflicts: the series template when the occurrence still
        # sits in the series' room, otherwise its own private booking.
        exclude_id = None
        own_prior = None
        if prior_exc is not None:
            own_prior = self.db.query(Booking).filter(
                Booking.event_id == prior_exc.id,
                Booking.is_recurring_template == False,   # noqa: E712
            ).first()
        if own_prior is not None:
            # It owns a booking, so the template no longer counts this occurrence —
            # its own row is the only thing that could self-conflict.
            exclude_id = own_prior.id
        elif template_booking is not None and target_room == tmpl_room:
            exclude_id = template_booking.id
        conflict = AvailabilityService(self.db).find_conflict(
            target_room, new_start, new_end, lock=True, exclude_booking_id=exclude_id,
        )
        if conflict:
            raise HTTPException(status_code=409, detail=conflict.message)

    # Same-SERIES destination guard. find_conflict excludes this series' own
    # template (so a same-slot title/kind edit doesn't self-conflict), but that
    # also hid moving an occurrence ONTO a SIBLING occurrence of the same series —
    # which produced a duplicate. Check the destination against the series' own
    # live occurrences (generated slots + moved exceptions), excluding the one
    # being replaced and any cancelled slot.
    ns_n, ne_n = _utc_naive(new_start), _utc_naive(new_end)
    edited = _utc_naive(occurrence_date)
    dur = root.end_time - root.start_time
    sib_hit = False
    sib_rrule = root.recurrence_rule.rrule if root.recurrence_rule else None
    for (s, e) in (expand_rrule(sib_rrule, root.start_time, dur, new_start - dur, new_end + dur) if sib_rrule else []):
        if _utc_naive(s) == edited:
            continue                          # the slot being replaced
        if _utc_naive(s) < ne_n and _utc_naive(e) > ns_n:
            ex = self.db.query(Event).filter(
                Event.parent_event_id == root_event_id, Event.occurrence_date == s).first()
            if not (ex and ex.status == EventStatus.CANCELLED):
                sib_hit = True
                break
    if not sib_hit:
        for ex in self.db.query(Event).filter(Event.parent_event_id == root_event_id).all():
            if ex.occurrence_date is not None and _utc_naive(ex.occurrence_date) == edited:
                continue                      # the exception being edited
            if ex.status != EventStatus.CANCELLED and ex.start_time is not None \
                    and _utc_naive(ex.start_time) < ne_n and _utc_naive(ex.end_time) > ns_n:
                sib_hit = True
                break
    if sib_hit:
        raise HTTPException(status_code=409, detail="That time already has an occurrence of this series.")

    # Step 4 — check if exception already exists for this date
    # If yes, update it instead of creating a new one
    existing = self.db.query(Event).filter(
        Event.parent_event_id == root_event_id,
        Event.occurrence_date == occurrence_date,
    ).first()

    if existing:
        # Update the existing exception
        existing.start_time   = new_start
        existing.end_time     = new_end
        existing.status       = EventStatus.CONFIRMED   # un-cancel if was cancelled
        if new_title:       existing.title       = new_title
        if new_description: existing.description = new_description
        if new_event_kind_id is not None: existing.event_kind_id = new_event_kind_id or None
        # Keep this occurrence's own room in step with its (possibly new) time, and
        # apply a room change if one was asked for.
        self._apply_occurrence_room(existing, target_room, tmpl_room,
                                    new_start, new_end, root.organizer_id)
        self.db.commit()
        return {
            "message":        "Occurrence updated",
            "exception_id":   existing.id,
            "occurrence_date": occurrence_date.isoformat(),
            "new_start":      new_start.isoformat(),
            "new_end":        new_end.isoformat(),
        }

    # Step 5 — create a new exception row
    exception_event = Event(
        title=new_title or root.title,
        description=new_description if new_description is not None else root.description,
        organizer_id=root.organizer_id,
        start_time=new_start,            # NEW time — different from root
        end_time=new_end,                # NEW time — can be different duration
        status=EventStatus.CONFIRMED,    # still happening, just moved
        parent_event_id=root_event_id,   # links to the series root
        occurrence_date=occurrence_date, # identifies WHICH slot is being replaced
        is_public=root.is_public,
        is_recurring_root=False,
        recurrence_rule_id=None,
        event_kind_id=(new_event_kind_id if new_event_kind_id is not None else root.event_kind_id),
    )
    self.db.add(exception_event)
    self.db.flush()          # need exception_event.id before attaching its booking
    self._apply_occurrence_room(exception_event, target_room, tmpl_room,
                                new_start, new_end, root.organizer_id)

    self._audit(actor, "occurrence.edited", "Event", root_event_id, {
        "original_start": occurrence_date.isoformat(),
    }, {
        "new_start": new_start.isoformat(),
        "new_end":   new_end.isoformat(),
    })

    self.db.commit()

    return {
        "message":         "Occurrence updated",
        "exception_id":    exception_event.id,
        "occurrence_date": occurrence_date.isoformat(),
        "new_start":       new_start.isoformat(),
        "new_end":         new_end.isoformat(),
    }





class BookingUpdate(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    notes: Optional[str] = None


# Attach as method — done via monkey-patch style addition here
def _update_booking(self, booking_id: str, data: 'BookingUpdate', actor: 'User') -> 'Booking':
    from app.modules.models import UserRole
    booking = self.db.query(Booking).filter(Booking.id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if actor.role != UserRole.ADMIN and booking.requester_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this booking")

    if booking.status in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {booking.status.value} booking")

    new_start = data.start_time or booking.start_time
    new_end = data.end_time or booking.end_time

    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    # A recurring series' TEMPLATE booking is the RRULE anchor that
    # AvailabilityService expands from (dtstart=template.start_time), while the
    # calendar renders the ROOT EVENT's times. Moving the booking alone slid every
    # occurrence's room reservation off the class the calendar shows — the room read
    # as free when it wasn't, for the whole semester, and the conflict check here only
    # ever looked at one occurrence. There is no scope ('this'/'following'/'all') on
    # this endpoint to do it correctly, so send the user to the event editor, which has.
    if booking.is_recurring_template and (data.start_time or data.end_time):
        raise HTTPException(
            status_code=400,
            detail="Repeating event. Edit it in the calendar.",
        )

    # Block moving a still-upcoming booking INTO the past (mirrors the create-time guard).
    # Only when the time actually changes AND the booking currently starts in the future —
    # so editing notes on a past booking, or fixing an already-past record, still works.
    if data.start_time:
        _now = _utc_naive(datetime.now(timezone.utc))
        if _utc_naive(new_start) < _now and _utc_naive(booking.start_time) >= _now:
            raise HTTPException(status_code=400, detail="Can't move an event into the past.")

    # Re-check conflict if times changed — reuse the shared, recurring-aware engine
    if data.start_time or data.end_time:
        conflict = AvailabilityService(self.db).find_conflict(
            booking.resource_id, new_start, new_end, lock=True, exclude_booking_id=booking_id
        )
        if conflict:
            raise HTTPException(status_code=409, detail=conflict.message)

        # Hard block on STUDENT clash when moving the booking (policy 2026-06-10)
        group_ids = [eg.group_id for eg in
                     self.db.query(EventGroup).filter(EventGroup.event_id == booking.event_id).all()]
        if STUDENT_CLASH_ENABLED and group_ids:
            for c in ClashService(self.db).find_clashes(
                    new_start, new_end, group_ids, [booking.resource_id],
                    exclude_event_id=booking.event_id):
                if c.student_clash:
                    raise HTTPException(
                        status_code=409,
                        detail=(f"Student clash: {c.shared_student_count} student(s) already have "
                                f"'{c.title}' at this time. Pick a different slot."))

    old = {"start_time": str(booking.start_time), "end_time": str(booking.end_time), "notes": booking.notes}
    if data.start_time:
        booking.start_time = data.start_time
    if data.end_time:
        booking.end_time = data.end_time
    if data.notes is not None:
        booking.notes = data.notes

    # Keep the parent event on the same clock. The calendar draws Event.start_time,
    # so moving only the booking left the block sitting at the old time while the room
    # was actually held at the new one — the reservation and the thing it reserves for
    # disagreed. Only for a plain one-off event with this as its sole booking: a
    # multi-resource event's individual bookings may legitimately differ from the
    # event window, and recurring templates are already refused above.
    if (data.start_time or data.end_time) and booking.event_id:
        parent = self.db.query(Event).filter(Event.id == booking.event_id).first()
        if parent and not parent.is_recurring_root and parent.parent_event_id is None:
            siblings = self.db.query(Booking).filter(
                Booking.event_id == parent.id,
                Booking.id != booking.id,
                Booking.status.notin_([BookingStatus.CANCELLED, BookingStatus.REJECTED]),
            ).count()
            if siblings == 0:
                parent.start_time = booking.start_time
                parent.end_time = booking.end_time

    self._audit(actor, "booking.updated", "Booking", booking_id, old,
                {"start_time": str(booking.start_time), "end_time": str(booking.end_time)})
    self.db.commit()
    self.db.refresh(booking)
    return booking


BookingService.update_booking = _update_booking


# ── Event update (for calendar drag/resize) ───────────────────

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    color: Optional[str] = None          # legacy per-event hex (superseded by event_kind)
    event_kind_id: Optional[str] = None  # change the event's type/colour
    # ── whole-event properties (added 2026-07-26) ──
    # resource_id: the room. An explicitly-sent null MEANS "remove the room"
    # (venue not decided yet), which is different from "field not sent" — so the
    # service checks `model_fields_set`, never None-ness, for these three.
    resource_id: Optional[str] = None
    group_ids: Optional[List[str]] = None
    is_public: Optional[bool] = None
    organizer_id: Optional[str] = None   # ADMIN only — hand an event to another member


# RRULE strings look like "FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20261231T235959Z".
# To move an end date, drop any existing UNTIL/COUNT and append a fresh UNTIL —
# the FREQ/BYDAY pattern is preserved untouched. UNTIL must be UTC ("Z"), so we
# normalise the datetime to naive-UTC first (a stray +05:30 mislabelled as Z
# would shift every occurrence).
def _rrule_with_until(rrule_string: str, until_dt: datetime) -> str:
    if until_dt.tzinfo is not None:
        off = until_dt.utcoffset()
        if off:
            until_dt = until_dt - off
        until_dt = until_dt.replace(tzinfo=None)
    until_str = until_dt.strftime('%Y%m%dT%H%M%SZ')
    parts = [p for p in rrule_string.split(';')
             if p and not p.upper().startswith('UNTIL=') and not p.upper().startswith('COUNT=')]
    parts.append(f'UNTIL={until_str}')
    return ';'.join(parts)


# "All events": edit the series root in place (the old default behaviour, now
# reached only via an explicit scope so it can never happen by accident).
def _update_series_whole(self, event, data: 'EventUpdate', actor: 'User') -> dict:
    # A whole-series time change means "this new TIME OF DAY for every occurrence",
    # NOT a new series start date. The v3 editor builds start_time from the CLICKED
    # occurrence's date, so overwriting the root's dtstart with it advanced the
    # series past — and PERMANENTLY dropped — every earlier occurrence. Keep the
    # series anchored on its own first-occurrence date; move only the time of day.
    if data.start_time:
        ns = (data.start_time if data.start_time.tzinfo else data.start_time.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
        cur = (event.start_time if event.start_time.tzinfo else event.start_time.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
        new_start = cur.replace(hour=ns.hour, minute=ns.minute, second=ns.second, microsecond=ns.microsecond)
    else:
        new_start = event.start_time
    dur = (data.end_time - data.start_time) if (data.start_time and data.end_time) else (event.end_time - event.start_time)
    new_end = new_start + dur

    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    # Re-check the whole series against each room's schedule at the NEW time
    # (uses the same shared helper as create_recurring_event).
    if (data.start_time or data.end_time) and event.recurrence_rule:
        win_start = event.recurrence_rule.start_date or new_start
        win_end = event.recurrence_rule.end_date or (new_start + timedelta(days=365))
        new_occ = expand_rrule(event.recurrence_rule.rrule, new_start,
                               new_end - new_start, win_start, win_end)
        for tb in event.bookings:
            if (tb.is_recurring_template and tb.resource_id
                    and tb.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)):
                msg = self._recurring_series_conflicts(
                    tb.resource_id, new_occ, win_start, win_end, exclude_template_id=tb.id,
                    exclude_root_id=event.id,   # don't collide with our own exceptions
                )
                if msg:
                    raise HTTPException(status_code=409, detail=msg)

    old = {"start_time": str(event.start_time), "end_time": str(event.end_time)}

    # Shifting the series time moves every generated RRULE instant, so child
    # exceptions (per-occurrence edits) must move with it or they'd stop matching
    # any occurrence — silently vanishing (and resurrecting if the series is moved
    # back). Shift each exception's occurrence_date by the same delta; also shift
    # its OWN start/end unless it was independently re-timed (a real move), in which
    # case the user's explicit placement is kept.
    if data.start_time:
        delta = new_start - (event.start_time if event.start_time.tzinfo else event.start_time.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
        if delta:
            for ex in self.db.query(Event).filter(Event.parent_event_id == event.id).all():
                moved = ex.occurrence_date is not None and ex.start_time is not None and \
                    _utc_naive(ex.start_time) != _utc_naive(ex.occurrence_date)
                if ex.occurrence_date is not None:
                    ex.occurrence_date = ex.occurrence_date + delta
                if not moved and ex.start_time is not None:
                    ex.start_time = ex.start_time + delta
                    ex.end_time = ex.end_time + delta
                # An exception that holds its OWN room (a per-occurrence venue change)
                # has its own Booking. Shifting only the Event left that booking sitting
                # at the old time: the calendar drew the occurrence at the new time in
                # room B while availability still had room B busy at the OLD time and
                # free at the new one — so the same room could be booked twice. Keep the
                # invariant that an exception's booking mirrors its own Event window.
                for b in ex.bookings:
                    if b.status in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                        continue
                    b.start_time = ex.start_time
                    b.end_time = ex.end_time

    if data.start_time or data.end_time:
        event.start_time = new_start   # time-of-day shifted, dtstart DATE preserved
        event.end_time   = new_end
    if data.title:           event.title         = data.title
    if data.description is not None: event.description = data.description
    if data.color is not None:       event.color       = data.color or None
    if data.event_kind_id is not None: event.event_kind_id = data.event_kind_id or None

    # Cascade to template booking (first-occurrence slot mirrors the root)
    for booking in event.bookings:
        if booking.is_recurring_template and booking.status not in (
            BookingStatus.CANCELLED, BookingStatus.REJECTED
        ):
            if data.start_time or data.end_time:
                booking.start_time = new_start
                booking.end_time   = new_end

    # Room / groups / visibility for the whole series (added 2026-07-26). Room last,
    # so its all-occurrences conflict check runs against the FINAL series times.
    if _sent(data, 'resource_id'):
        self._change_series_room(event, data.resource_id, new_start, new_end)
    if _sent(data, 'organizer_id'):
        self._change_organizer(event, data.organizer_id, actor)
    self._apply_groups_and_visibility(event, data)

    self._audit(actor, "recurring_series.updated", "Event", event.id, old, {
        "start_time": str(event.start_time),
        "end_time":   str(event.end_time),
    })
    self.db.commit()
    self.db.refresh(event)
    return {
        "updated":    "series",
        "event_id":   event.id,
        "start_time": event.start_time.isoformat(),
        "end_time":   event.end_time.isoformat(),
    }


# "This and following": split the series at the chosen occurrence. The original
# series is truncated to end just before it; a NEW series (carrying the change)
# runs from it to the original end. This is how Google Calendar treats the
# middle option, and it keeps every earlier occurrence exactly as it was.
def _update_series_following(self, root_event_id: str, split_date: datetime,
                             data: 'EventUpdate', actor: 'User') -> dict:
    from app.modules.models import UserRole, EventStatus, RecurrenceRule

    root = self.db.query(Event).filter(Event.id == root_event_id).first()
    if not root:
        raise HTTPException(status_code=404, detail="Event not found")
    if actor.role != UserRole.ADMIN and root.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if not root.is_recurring_root or not root.recurrence_rule:
        raise HTTPException(status_code=400, detail="Not a recurring event series")

    rule = root.recurrence_rule
    duration_old = root.end_time - root.start_time

    # Splitting at (or before) the very first occurrence changes everything —
    # there's nothing to keep, so it's just an "all events" edit.
    if split_date <= root.start_time:
        return self._update_series_whole(root, data, actor)

    new_start = data.start_time or split_date
    new_end   = data.end_time or (new_start + duration_old)
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    original_end_date = rule.end_date

    # 1. Truncate the original series to end just before the split point.
    cutoff = split_date - timedelta(seconds=1)
    rule.rrule = _rrule_with_until(rule.rrule, cutoff)
    rule.end_date = cutoff

    # 2. A new rule from the split onward — same FREQ/BYDAY pattern, original end.
    if original_end_date:
        new_rrule = _rrule_with_until(rule.rrule, original_end_date)
    else:
        new_rrule = ';'.join(p for p in rule.rrule.split(';')
                             if p and not p.upper().startswith('UNTIL='))
    new_rule = RecurrenceRule(rrule=new_rrule, start_date=new_start, end_date=original_end_date)
    self.db.add(new_rule)
    self.db.flush()

    # 3. The new series root, carrying the edit.
    new_root = Event(
        title=data.title or root.title,
        description=data.description if data.description is not None else root.description,
        organizer_id=root.organizer_id,
        start_time=new_start,
        end_time=new_end,
        status=EventStatus.CONFIRMED,
        recurrence_rule_id=new_rule.id,
        is_recurring_root=True,
        is_public=root.is_public,
        event_kind_id=(data.event_kind_id if data.event_kind_id is not None else root.event_kind_id),
        color=root.color,
    )
    self.db.add(new_root)
    self.db.flush()

    # 4. Copy the cohort links (student-clash detection needs them on the new root too).
    for eg in self.db.query(EventGroup).filter(EventGroup.event_id == root.id).all():
        self.db.add(EventGroup(event_id=new_root.id, group_id=eg.group_id))

    # 5. Copy the booking template(s), re-checking the room over the new window.
    win_end = original_end_date or (new_start + timedelta(days=365))
    new_occ = expand_rrule(new_rrule, new_start, new_end - new_start, new_start, win_end)
    for bt in root.bookings:
        if bt.is_recurring_template and bt.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
            if bt.resource_id:
                msg = self._recurring_series_conflicts(
                    bt.resource_id, new_occ, new_start, win_end, exclude_template_id=bt.id,
                    exclude_root_id=root.id,    # nor with the exceptions we're handing over
                )
                if msg:
                    self.db.rollback()
                    raise HTTPException(status_code=409, detail=msg)
            self.db.add(Booking(
                event_id=new_root.id,
                resource_id=bt.resource_id,
                requester_id=bt.requester_id,
                start_time=new_start,
                end_time=new_end,
                status=bt.status,
                notes=bt.notes,
                is_recurring_template=True,
                recurrence_rule_id=new_rule.id,
            ))

    # 6. Hand off exceptions on/after the split to the new series (a Friday you'd
    #    already moved or cancelled stays moved/cancelled, now under the new root).
    #    An exception is matched to an occurrence by its occurrence_date, so when the
    #    split ALSO changes the time of day the handed-over exceptions must be shifted
    #    by the same delta or they stop matching anything the new rule generates: a
    #    cancelled Monday reappears (its suppression no longer lines up) and a moved
    #    one renders twice — once as a plain RRULE occurrence, once as the exception.
    exc_delta = _utc_naive(new_start) - _utc_naive(split_date)
    for ex in self.db.query(Event).filter(Event.parent_event_id == root.id).all():
        if ex.occurrence_date is not None and ex.occurrence_date >= split_date:
            ex.parent_event_id = new_root.id
            if exc_delta:
                # Same rule as _update_series_whole: keep an independently re-timed
                # occurrence where the user put it, but re-point which slot it replaces.
                moved = ex.start_time is not None and \
                    _utc_naive(ex.start_time) != _utc_naive(ex.occurrence_date)
                ex.occurrence_date = ex.occurrence_date + exc_delta
                if not moved and ex.start_time is not None:
                    ex.start_time = ex.start_time + exc_delta
                    ex.end_time = ex.end_time + exc_delta
                for b in ex.bookings:          # its own room hold follows its window
                    if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                        b.start_time = ex.start_time
                        b.end_time = ex.end_time

    self._audit(actor, "recurring_series.split", "Event", root.id,
                {"split_at": split_date.isoformat()},
                {"new_root": new_root.id})
    self.db.commit()
    return {
        "updated":       "following",
        "old_event_id":  root.id,
        "new_event_id":  new_root.id,
        "split_at":      split_date.isoformat(),
        "start_time":    new_start.isoformat(),
        "end_time":      new_end.isoformat(),
    }


BookingService._update_series_whole = _update_series_whole
BookingService._update_series_following = _update_series_following


# ── Editing the "whole-event" properties: room, groups, visibility ────────────
# The room is a Booking (one-off) or the recurring TEMPLATE booking (series); the
# cohort tags are EventGroup rows; visibility is Event.is_public. All three are
# series-wide for a recurring event — there is no per-occurrence room today.

def _sent(data, field: str) -> bool:
    """Was this field EXPLICITLY provided by the client?

    `resource_id: null` means "remove the room", which None-checking cannot tell
    apart from "field omitted". Pydantic records what actually arrived, so ask it."""
    fields_set = getattr(data, 'model_fields_set', None)          # pydantic v2
    if fields_set is None:
        fields_set = getattr(data, '__fields_set__', set())        # pydantic v1
    return field in fields_set


def _resolve_room(self, resource_id):
    """An ACTIVE resource for this id, or None when the caller asked for no room.
    Raises 404 for an unknown/deactivated room rather than failing later at commit."""
    if resource_id is None:
        return None
    r = self.db.query(Resource).filter(
        Resource.id == resource_id,
        Resource.is_active == True,   # noqa: E712
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail="Room not found")
    return r


def _active_bookings(event, template_only=False):
    return [
        b for b in event.bookings
        if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)
        and (b.is_recurring_template if template_only else not b.is_recurring_template)
    ]


def _change_oneoff_room(self, event, target_id, new_start, new_end):
    """Point a one-off event at a different room (or at no room at all)."""
    active = _active_bookings(event)
    if len(active) > 1:
        raise HTTPException(
            status_code=400,
            detail="Multiple rooms. Edit in Bookings.")
    room = self._resolve_room(target_id)
    current = active[0] if active else None

    if room is None:                                   # "venue not decided yet"
        if current is not None:
            current.status = BookingStatus.CANCELLED   # frees the old room
        return
    if current is not None and current.resource_id == room.id:
        return                                         # unchanged — nothing to do

    # The new room must actually be free. Same engine (and advisory lock) the
    # create path uses, so this can't race a concurrent booking.
    conflict = AvailabilityService(self.db).find_conflict(
        room.id, new_start, new_end, lock=True,
        exclude_booking_id=current.id if current is not None else None)
    if conflict:
        raise HTTPException(status_code=409, detail=conflict.message)

    status = BookingStatus.PENDING if room.requires_approval else BookingStatus.CONFIRMED
    if current is not None:
        current.resource_id = room.id
        current.start_time  = new_start
        current.end_time    = new_end
        current.status      = status
    else:
        self.db.add(Booking(
            event_id=event.id, resource_id=room.id, requester_id=event.organizer_id,
            start_time=new_start, end_time=new_end, status=status))


def _change_series_room(self, event, target_id, new_start, new_end):
    """Point a whole recurring series at a different room (or at no room)."""
    templates = _active_bookings(event, template_only=True)
    if len(templates) > 1:
        raise HTTPException(
            status_code=400,
            detail="Multiple rooms. Edit in Bookings.")
    room = self._resolve_room(target_id)
    current = templates[0] if templates else None

    if room is None:
        if current is not None:
            current.status = BookingStatus.CANCELLED
        return
    if current is not None and current.resource_id == room.id:
        return

    # EVERY occurrence has to fit in the new room, not just the first — same
    # all-or-nothing rule create_recurring_event applies.
    rule = event.recurrence_rule
    if rule is not None:
        win_start = rule.start_date or new_start
        win_end = rule.end_date or (new_start + timedelta(days=365))
        # EXCEPTION-AWARE, not a raw expand_rrule. An occurrence that was moved to a
        # different time still belongs to this series and so inherits the new room —
        # at its moved time, which the raw expansion never mentions, so it went into
        # the new room completely unchecked and could land straight on top of someone
        # else's booking. The helper also drops occurrences that hold their OWN room
        # (they aren't moving) and cancelled ones (they occupy nothing).
        occ = ClashService(self.db)._effective_occurrences_for_root(event, win_start, win_end)
        msg = self._recurring_series_conflicts(
            room.id, occ, win_start, win_end,
            exclude_template_id=current.id if current is not None else None,
            exclude_root_id=event.id)
        if msg:
            raise HTTPException(status_code=409, detail=msg)

    status = BookingStatus.PENDING if room.requires_approval else BookingStatus.CONFIRMED
    if current is not None:
        current.resource_id = room.id
        current.status      = status
    else:
        self.db.add(Booking(
            event_id=event.id, resource_id=room.id, requester_id=event.organizer_id,
            start_time=new_start, end_time=new_end, status=status,
            is_recurring_template=True, recurrence_rule_id=event.recurrence_rule_id))


def _change_organizer(self, event, new_organizer_id, actor):
    """Hand an event over to another member. ADMIN ONLY.

    Needed because a bulk-imported timetable lands under whoever ran the import;
    an admin then assigns each class to the faculty who actually teaches it."""
    from app.modules.models import UserRole
    if actor.role != UserRole.ADMIN:
        raise HTTPException(status_code=403,
                            detail="Only an admin can change who owns an event.")
    if not new_organizer_id:
        raise HTTPException(status_code=400, detail="Choose who should own this event.")
    u = self.db.query(User).filter(
        User.id == new_organizer_id,
        User.is_active == True,   # noqa: E712
    ).first()
    if not u:
        raise HTTPException(status_code=404,
                            detail="That member was not found, or their account is deactivated.")
    if u.role == UserRole.VIEWER:
        raise HTTPException(status_code=400,
                            detail="A view-only member can't own an event. Change their role first.")
    if u.id == event.organizer_id:
        return
    event.organizer_id = u.id
    # The room claim must follow the owner. If it didn't, the PREVIOUS organizer
    # would still hold the booking — so slot requests for this room would be routed
    # to them, and the new owner couldn't move their own class.
    for b in event.bookings:
        if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
            b.requester_id = u.id

    # ...and so must the EXCEPTIONS' own claims. An occurrence moved to its own room
    # carries its Booking on the exception Event, which `event.bookings` never sees.
    # Left behind, a slot request for that date was addressed to the previous
    # organizer — who no longer owns the class and can't act on it — while the real
    # owner saw nothing at all.
    for ex in self.db.query(Event).filter(Event.parent_event_id == event.id).all():
        ex.organizer_id = u.id
        for b in ex.bookings:
            if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                b.requester_id = u.id


def _apply_groups_and_visibility(self, event, data):
    """Re-tag the cohorts and/or flip public/private. Both are plain event
    properties — no room involved, so nothing here can cause a booking conflict."""
    if _sent(data, 'is_public') and data.is_public is not None:
        event.is_public = bool(data.is_public)

    if _sent(data, 'group_ids') and data.group_ids is not None:
        wanted = {g for g in data.group_ids if g}
        if wanted:
            # The create path skips this check, which turns a stale id into an
            # opaque 500 at commit. Fail clearly instead.
            found = {g.id for g in self.db.query(Group).filter(Group.id.in_(list(wanted))).all()}
            if wanted - found:
                raise HTTPException(status_code=400,
                                    detail="One or more selected groups no longer exist.")
        existing = self.db.query(EventGroup).filter(EventGroup.event_id == event.id).all()
        have = {eg.group_id for eg in existing}
        for eg in existing:
            if eg.group_id not in wanted:
                self.db.delete(eg)
        for gid in (wanted - have):
            self.db.add(EventGroup(event_id=event.id, group_id=gid))


BookingService._resolve_room = _resolve_room
BookingService._change_oneoff_room = _change_oneoff_room
BookingService._change_series_room = _change_series_room
BookingService._change_organizer = _change_organizer
BookingService._apply_groups_and_visibility = _apply_groups_and_visibility


def _update_event(self, event_id: str, data: 'EventUpdate', actor: 'User',
                  occurrence_date: datetime = None, scope: str = None) -> dict:
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if actor.role != UserRole.ADMIN and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled event")

    # ── Recurring event — an EXPLICIT scope decides what changes ──
    # 'occurrence' → just this one (an exception row)
    # 'following'  → this one and every later one (split the series)
    # 'series'     → the whole series in place
    # Nothing implicit: with no scope and no occurrence we refuse, so a stray
    # edit can never silently rewrite a whole timetable again.
    if event.is_recurring_root:
        eff_scope = scope or ('occurrence' if occurrence_date else None)
        # Room / groups / visibility live on the SERIES (the room is the template
        # booking; the tags and the public flag are on the root), so they cannot be
        # changed for a single occurrence. Say so plainly instead of quietly applying
        # a series-wide change from an edit the user scoped to one date.
        # Groups, visibility and owner genuinely belong to the whole series (they live
        # on the root event), so they cannot be set for one date. The ROOM can — an
        # occurrence carries its own booking — so resource_id is deliberately absent
        # from this guard for 'occurrence' scope.
        if eff_scope == 'occurrence' and (
                _sent(data, 'group_ids') or _sent(data, 'is_public') or _sent(data, 'organizer_id')):
            raise HTTPException(
                status_code=400,
                detail="Groups, visibility and owner apply to the whole series. "
                       "Choose “All events” to change them.")
        if eff_scope == 'following' and (
                _sent(data, 'resource_id') or _sent(data, 'group_ids')
                or _sent(data, 'is_public') or _sent(data, 'organizer_id')):
            raise HTTPException(
                status_code=400,
                detail="Room, groups, visibility and owner apply to the whole series. "
                       "Choose “All events” to change them.")
        if eff_scope == 'occurrence':
            if not occurrence_date:
                raise HTTPException(status_code=400,
                                    detail="Editing one occurrence needs which occurrence to change.")
            # Resolve to the true anchor first (off-by-minutes, or a re-edit of an
            # already-moved occurrence whose target is its moved slot).
            anchor = _snap_occurrence_instant(event, occurrence_date, db=self.db) or occurrence_date
            occ_dur = event.end_time - event.start_time
            # When the edit omits times (title/kind-only), keep the occurrence where
            # it currently is: a prior exception's OWN time if it was moved, else the
            # occurrence's real slot — never snap it back and silently undo a move.
            prior = self.db.query(Event).filter(
                Event.parent_event_id == event_id, Event.occurrence_date == anchor).first()
            def_start = prior.start_time if prior else anchor
            def_end = prior.end_time if prior else (anchor + occ_dur)
            return self.edit_occurrence(
                root_event_id=event_id,
                occurrence_date=anchor,
                new_start=data.start_time or def_start,
                new_end=data.end_time or def_end,
                actor=actor,
                new_title=data.title,
                new_description=data.description,
                new_event_kind_id=data.event_kind_id,
                # only when the client actually asked — _UNSET means "leave the room alone"
                new_resource_id=(data.resource_id if _sent(data, 'resource_id') else _UNSET),
            )
        if eff_scope == 'following':
            if not occurrence_date:
                raise HTTPException(status_code=400,
                                    detail="Splitting a series needs the occurrence to split at.")
            return self._update_series_following(event_id, occurrence_date, data, actor)
        if eff_scope == 'series':
            return self._update_series_whole(event, data, actor)
        raise HTTPException(
            status_code=400,
            detail="Choose a scope: this, following, or all.",
        )

    # ── Normal one-off event ─────────────────────────────────────
    else:
        new_start = data.start_time or event.start_time
        new_end   = data.end_time   or event.end_time

        if new_end <= new_start:
            raise HTTPException(status_code=400, detail="end_time must be after start_time")

        if data.start_time or data.end_time:
            av = AvailabilityService(self.db)
            # If the SAME save also moves the event to a different room, the room being
            # left must not be tested at the new time — the event won't be in it. That
            # check rejected a perfectly valid "new time + new room" edit with a 409
            # naming a room that wasn't even in the request, and the only way through
            # was to save the two changes separately. _change_oneoff_room below does
            # check the room we're moving TO, at these same final times.
            leaving_room = _sent(data, 'resource_id')
            target_room_id = data.resource_id if leaving_room else None
            for b in event.bookings:
                if b.status in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                    continue
                if leaving_room and str(b.resource_id) != str(target_room_id):
                    continue
                conflict = av.find_conflict(
                    b.resource_id, new_start, new_end, lock=True, exclude_booking_id=b.id
                )
                if conflict:
                    raise HTTPException(status_code=409, detail=conflict.message)

            # Hard block on STUDENT clash when moving the event (policy 2026-06-10)
            group_ids = [eg.group_id for eg in
                         self.db.query(EventGroup).filter(EventGroup.event_id == event.id).all()]
            if STUDENT_CLASH_ENABLED and group_ids:
                resource_ids = [b.resource_id for b in event.bookings
                                if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)]
                for c in ClashService(self.db).find_clashes(
                        new_start, new_end, group_ids, resource_ids, exclude_event_id=event.id):
                    if c.student_clash:
                        raise HTTPException(
                            status_code=409,
                            detail=(f"Student clash: {c.shared_student_count} student(s) already have "
                                    f"'{c.title}' at this time. Pick a different slot."))

        old = {"start_time": str(event.start_time), "end_time": str(event.end_time)}

        if data.start_time:      event.start_time   = data.start_time
        if data.end_time:        event.end_time      = data.end_time
        if data.title:           event.title         = data.title
        if data.description is not None: event.description = data.description
        if data.color is not None:       event.color       = data.color or None
        if data.event_kind_id is not None: event.event_kind_id = data.event_kind_id or None

        for booking in event.bookings:
            if booking.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                if data.start_time: booking.start_time = data.start_time
                if data.end_time:   booking.end_time   = data.end_time

        # Room / groups / visibility (added 2026-07-26). Room last, so it books the
        # FINAL times and its conflict check sees exactly what will be stored.
        if _sent(data, 'resource_id'):
            self._change_oneoff_room(event, data.resource_id, new_start, new_end)
        if _sent(data, 'organizer_id'):
            self._change_organizer(event, data.organizer_id, actor)
        self._apply_groups_and_visibility(event, data)

        self._audit(actor, "event.updated", "Event", event_id, old, {
            "start_time": str(event.start_time),
            "end_time":   str(event.end_time),
        })
        self.db.commit()
        self.db.refresh(event)
        return {
            "updated":    "event",
            "event_id":   event.id,
            "start_time": event.start_time.isoformat(),
            "end_time":   event.end_time.isoformat(),
        }


BookingService.update_event = _update_event


def _cancel_series_following(self, root_event_id: str, split_date: datetime, actor: 'User') -> dict:
    """'This and following': drop this occurrence and every later one by
    truncating the series to end just before it. Earlier occurrences stay."""
    from app.modules.models import UserRole

    root = self.db.query(Event).filter(Event.id == root_event_id).first()
    if not root:
        raise HTTPException(status_code=404, detail="Event not found")
    if actor.role != UserRole.ADMIN and root.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if not root.is_recurring_root or not root.recurrence_rule:
        raise HTTPException(status_code=400, detail="Not a recurring event series")

    # Resolve to the true anchor (handles an off-instant date, or a split point that
    # was given as a previously-moved occurrence's moved time — otherwise the cutoff
    # lands after the real slot and neither the RRULE occurrence nor its exception is
    # removed). Snapping keys off the exception's occurrence_date, not the moved time.
    snapped = _snap_occurrence_instant(root, split_date, db=self.db)
    if snapped is None:
        # off-occurrence date → refuse, don't silently truncate the series (mirror
        # _cancel_occurrence, so all scopes validate the date the same way)
        raise HTTPException(status_code=400, detail="That date isn't an occurrence of this series.")
    split_date = snapped

    # Cancelling from the first occurrence onward removes the whole thing.
    if split_date <= root.start_time:
        return self.delete_series(root_event_id, actor)

    cutoff = split_date - timedelta(seconds=1)
    root.recurrence_rule.rrule = _rrule_with_until(root.recurrence_rule.rrule, cutoff)
    root.recurrence_rule.end_date = cutoff

    # Exceptions on/after the split have no series to belong to now. CANCEL them
    # (don't hard-delete): an occurrence moved to its own room carries a private
    # booking, and deleting the row would either strand that booking or trip the
    # NOT NULL slot_release_requests FK. Cancelling the exception AND its booking
    # frees the room properly — availability/clash both drop a CANCELLED exception
    # before they ever look at its room.
    for ex in self.db.query(Event).filter(Event.parent_event_id == root.id).all():
        if ex.occurrence_date is not None and ex.occurrence_date >= split_date:
            ex.status = EventStatus.CANCELLED
            for bk in ex.bookings:
                if bk.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                    bk.status = BookingStatus.CANCELLED

    self._audit(actor, "recurring_series.truncated", "Event", root.id, None,
                {"effective_until": cutoff.isoformat()})
    self.db.commit()
    return {
        "cancelled":       "following",
        "event_id":        root.id,
        "effective_until": cutoff.isoformat(),
    }


BookingService._cancel_series_following = _cancel_series_following


def _cancel_event(self, event_id: str, actor: 'User', occurrence_date: datetime = None,
                  scope: str = None) -> dict:
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if actor.role != UserRole.ADMIN and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # ── Recurring event — an EXPLICIT scope decides how much is cancelled ──
    if event.is_recurring_root:
        eff_scope = scope or ('occurrence' if occurrence_date else None)
        if eff_scope == 'occurrence':
            if not occurrence_date:
                raise HTTPException(status_code=400,
                                    detail="Cancelling one occurrence needs which occurrence.")
            return self.cancel_occurrence(
                root_event_id=event_id,
                occurrence_date=occurrence_date,
                actor=actor,
            )
        if eff_scope == 'following':
            if not occurrence_date:
                raise HTTPException(status_code=400,
                                    detail="Cancelling from an occurrence onward needs which occurrence.")
            return self._cancel_series_following(event_id, occurrence_date, actor)
        if eff_scope == 'series':
            return self.delete_series(event_id, actor)
        raise HTTPException(
            status_code=400,
            detail="Choose a scope: this, following, or all.",
        )

    # ── Cancel a normal one-off event ─────────────────────────
    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Event already cancelled")

    event.status = EventStatus.CANCELLED
    for booking in event.bookings:
        if booking.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
            booking.status = BookingStatus.CANCELLED

    self._audit(actor, "event.cancelled", "Event", event_id, None, None)
    self.db.commit()
    self.db.refresh(event)
    bus.publish("event.cancelled", {"event_id": event.id, "actor_id": actor.id})

    return {
        "cancelled": "event",
        "event_id":  event.id,
        "title":     event.title,
        "status":    event.status.value,
    }


BookingService.cancel_event = _cancel_event


def _delete_series(self, event_id: str, actor: 'User') -> dict:
    """
    Permanently cancels an entire recurring series.

    Different from cancel_event because:
    - Only valid on is_recurring_root = True
    - Also cancels all exception rows for this series
    - Also cancels the template booking
    - Explicit intent — frontend must call this route deliberately

    Why separate from cancel_event?
    Cancelling one occurrence vs cancelling the entire series
    are fundamentally different operations with different consequences.
    The route itself communicates the intent — no ambiguity.
    """
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # This route is only for recurring series roots
    # One-off events use cancel_event
    if not event.is_recurring_root:
        raise HTTPException(
            status_code=400,
            detail="This event is not a recurring series. "
                   "Use POST /events/{id}/cancel for one-off events."
        )

    if actor.role != UserRole.ADMIN and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Series already cancelled")

    # Cancel the root event
    event.status = EventStatus.CANCELLED

    # Cancel the template booking
    # This stops conflict detection from protecting slots for this series
    for booking in event.bookings:
        if booking.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
            booking.status = BookingStatus.CANCELLED

    # Cancel all exception rows for this series
    # These are individual occurrence edits/cancellations
    # Without this they'd be orphaned rows pointing to a cancelled root
    exceptions = self.db.query(Event).filter(
        Event.parent_event_id == event_id
    ).all()
    for exc in exceptions:
        exc.status = EventStatus.CANCELLED
        # An occurrence that had been moved to its OWN room holds a private booking.
        # find_conflict matches raw ACTIVE bookings regardless of their event's
        # status, so without this that room stays blocked forever after the series
        # is deleted.
        for bk in exc.bookings:
            if bk.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                bk.status = BookingStatus.CANCELLED

    self._audit(actor, "recurring_series.deleted", "Event", event_id, None, {
        "title":            event.title,
        "exceptions_count": len(exceptions),
    })
    self.db.commit()
    bus.publish("event.cancelled", {"event_id": event.id, "actor_id": actor.id})

    return {
        "deleted":          "series",
        "event_id":         event.id,
        "title":            event.title,
        "exceptions_also_cancelled": len(exceptions),
    }


BookingService.delete_series = _delete_series


def _get_event_detail(self, event_id: str, actor: 'User') -> dict:
    """
    Returns a single event with its bookings — used by calendar click.
    """
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Visibility check
    if actor.role != UserRole.ADMIN and not event.is_public and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this event")

    bookings = []
    for b in event.bookings:
        resource = self.db.query(Resource).filter(Resource.id == b.resource_id).first()
        bookings.append({
            "id":            b.id,
            "resource_id":   b.resource_id,
            "resource_name": resource.name if resource else "Unknown",
            "status":        b.status.value,
            "start_time":    b.start_time.isoformat(),
            "end_time":      b.end_time.isoformat(),
            "notes":         b.notes,
        })

    organizer = self.db.query(User).filter(User.id == event.organizer_id).first()

    # Which cohorts this event is for. Tagged at creation but previously never
    # returned, so the UI could set groups and then never show them again.
    group_rows = (
        self.db.query(Group.id, Group.name)
        .join(EventGroup, EventGroup.group_id == Group.id)
        .filter(EventGroup.event_id == event.id)
        .all()
    )

    return {
        "id":           event.id,
        "title":        event.title,
        "description":  event.description,
        "status":       event.status.value,
        "start_time":   event.start_time.isoformat(),
        "end_time":     event.end_time.isoformat(),
        "is_public":    event.is_public,
        "organizer_id": event.organizer_id,
        "organizer_name": organizer.full_name if organizer else "Unknown",
        "is_mine":      event.organizer_id == actor.id,
        "color":        event.color,
        "event_kind_id": event.event_kind_id,
        "kind_name":    event.event_kind.name if event.event_kind else None,
        "kind_color":   event.event_kind.color if event.event_kind else None,
        "group_ids":    [g.id for g in group_rows],
        "group_names":  [g.name for g in group_rows],
        # The calendar feed carries these, but the detail endpoint did not — so an
        # event opened from a NOTIFICATION deep-link (which has only the id, and so
        # must use this endpoint) looked one-off. The UI then offered "Cancel event"
        # and saved edits with no scope, and the backend answered with a raw 400
        # telling the user to choose a scope the sheet never showed them.
        "is_recurring_root": bool(event.is_recurring_root),
        "parent_event_id":   event.parent_event_id,
        "bookings":     bookings,
    }


def _get_calendar_events(self, actor, start, end):
    """
    Returns calendar events for a date range.

    Two types of events are returned:
    1. Normal one-time events — queried directly by start_time
    2. Recurring events — root event is fetched, then RRULE is expanded
       to generate occurrences within the requested range.
       Exceptions (cancelled/edited occurrences) are checked per occurrence.
    """
    from app.modules.models import UserRole, RecurrenceRule
    from app.core.recurrence import get_occurrences_in_range
    from sqlalchemy import or_
    from datetime import datetime, timedelta, timezone

    result = []
    is_anon = actor is None        # anonymous (public) viewer — no logged-in user

    # event_id -> [group ids], fetched in ONE query so the calendar can be
    # filtered by cohort without an N+1 lookup per event.
    groups_by_event = {}
    for _eid, _gid in self.db.query(EventGroup.event_id, EventGroup.group_id).all():
        groups_by_event.setdefault(_eid, []).append(_gid)

    # resource_id -> name, in ONE query. The calendar feed carries the room name on
    # every block ("venues") so the grid can label and FILTER by room for everyone.
    # Previously the frontend joined room names from GET /bookings, which returns
    # only the caller's OWN bookings — so a non-admin saw every colleague's event
    # with no room and the room filter silently skipped them.
    resource_name_by_id = {
        _rid: _rname for _rid, _rname in self.db.query(Resource.id, Resource.name).all()
    }

    def _ids_of(bookings):
        """Room IDs for a set of bookings — the UI needs ids (not names) to pre-select
        the venue picker, and room names are not guaranteed unique."""
        out = []
        for b in bookings:
            if b.resource_id and b.resource_id not in out:
                out.append(b.resource_id)
        return out

    def _venues_of(bookings):
        """Room names for a set of bookings, de-duplicated, order preserved."""
        names = []
        for b in bookings:
            nm = resource_name_by_id.get(b.resource_id) if b.resource_id else None
            if nm and nm not in names:
                names.append(nm)
        return names

    # Helper — strips timezone info and normalises to UTC naive datetime
    # Used for reliable datetime comparison regardless of how
    # PostgreSQL or Python serialises the timezone offset
    def to_utc_naive(dt):
        if dt is None:
            return None
        if dt.tzinfo is not None:
            offset = dt.utcoffset()
            dt = dt - offset if offset else dt
            return dt.replace(tzinfo=None)
        return dt

    # ── Part 1: Normal one-time events ───────────────────────────
    # Query events that:
    #   - start within the requested window
    #   - are not cancelled
    #   - are not recurring roots (those are handled in Part 2)
    #   - are not exception rows (parent_event_id is set — those
    #     are handled as part of their root event in Part 2)
    q = self.db.query(Event).filter(
        Event.start_time >= start,
        Event.start_time <= end,
        Event.status != EventStatus.CANCELLED,
        Event.is_recurring_root == False,
        Event.parent_event_id == None,        # exclude exception rows
    )
    if is_anon:
        q = q.filter(Event.is_public == True)                       # public viewers: public events only
    elif actor.role != UserRole.ADMIN:
        q = q.filter(
            or_(Event.organizer_id == actor.id, Event.is_public == True)
        )

    for e in q.order_by(Event.start_time).all():
        active_bookings = [
            b for b in e.bookings
            if b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)
        ]
        booking_statuses = list({b.status.value for b in active_bookings})

        result.append({
            "id":               e.id,
            "title":            e.title,
            "start":            e.start_time.isoformat(),
            "end":              e.end_time.isoformat(),
            "status":           e.status.value,
            "booking_statuses": booking_statuses,
            "is_mine":          (not is_anon) and e.organizer_id == actor.id,
            "organizer_id":     None if is_anon else e.organizer_id,
            "description":      e.description,
            "is_public":        e.is_public,
            "color":            e.color,
            "kind_name":        e.event_kind.name if e.event_kind else None,
            "kind_color":       e.event_kind.color if e.event_kind else None,
            "event_kind_id":    e.event_kind_id,
            "group_ids":        groups_by_event.get(e.id, []),
            "venues":           _venues_of(active_bookings),
            "venue_ids":        _ids_of(active_bookings),
            "is_recurring":     False,
            "is_exception":     False,
        })

    # ── Part 2: Recurring events — expand RRULE ──────────────────
    # Fetch all recurring root events.
    # No date range filter here because a root event's start_time
    # is the first occurrence only — it may be months in the past
    # while still generating occurrences this week.
    rq = self.db.query(Event).filter(
        Event.is_recurring_root == True,
        Event.status != EventStatus.CANCELLED,
    )
    if is_anon:
        rq = rq.filter(Event.is_public == True)
    elif actor.role != UserRole.ADMIN:
        rq = rq.filter(
            or_(Event.organizer_id == actor.id, Event.is_public == True)
        )

    for root_event in rq.all():
        if not root_event.recurrence_rule:
            continue

        rule     = root_event.recurrence_rule
        duration = root_event.end_time - root_event.start_time

        # Expand the RRULE — returns only occurrences within [start, end]
        occurrences = get_occurrences_in_range(
            rrule_string=rule.rrule,
            dtstart=root_event.start_time,
            duration=duration,
            range_start=start,
            range_end=end,
        )

        # NOTE: no "if not occurrences: continue" here — an occurrence MOVED INTO
        # this window from an out-of-window original slot still has to show, even
        # when the series generates no RRULE slot in-window (the second pass below).

        # Exception rows for this series (parent_event_id → this root), keyed by the
        # ORIGINAL slot they replace so the RRULE loop can suppress that slot.
        exceptions = self.db.query(Event).filter(
            Event.parent_event_id == root_event.id,
        ).all()
        exception_map = {}
        for exc in exceptions:
            if exc.occurrence_date is not None:
                exception_map[to_utc_naive(exc.occurrence_date)] = exc

        # Template booking status — same for all occurrences in the series
        template_bookings = [
            b for b in root_event.bookings
            if b.is_recurring_template
            and b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)
        ]
        booking_statuses = list({b.status.value for b in template_bookings})

        w_start = to_utc_naive(start)
        w_end = to_utc_naive(end)
        emitted_exc = set()

        # An occurrence moved to its OWN room carries a private booking; show THAT
        # room on the block, not the series' room.
        exc_own_bookings = {}
        if exceptions:
            for _b in self.db.query(Booking).filter(
                Booking.event_id.in_([e.id for e in exceptions]),
                Booking.is_recurring_template == False,   # noqa: E712
            ).all():
                exc_own_bookings.setdefault(_b.event_id, []).append(_b)

        def _exc_venues(exception):
            own = exc_own_bookings.get(exception.id)
            if own is None:
                return _venues_of(template_bookings)      # inherits the series' room
            live = [b for b in own if b.status not in
                    (BookingStatus.CANCELLED, BookingStatus.REJECTED)]
            return _venues_of(live)                       # [] when explicitly room-less

        def _exc_venue_ids(exception):
            own = exc_own_bookings.get(exception.id)
            if own is None:
                return _ids_of(template_bookings)
            live = [b for b in own if b.status not in
                    (BookingStatus.CANCELLED, BookingStatus.REJECTED)]
            return _ids_of(live)

        def _emit_exception(exception, original_iso):
            # Render an edited occurrence at its ACTUAL (possibly moved) time.
            emitted_exc.add(exception.id)
            result.append({
                "id":               root_event.id,
                "exception_id":     exception.id,
                "title":            exception.title,
                "start":            exception.start_time.isoformat(),
                "end":              exception.end_time.isoformat(),
                "status":           exception.status.value,
                "booking_statuses": booking_statuses,
                "is_mine":          (not is_anon) and root_event.organizer_id == actor.id,
                "organizer_id":     None if is_anon else root_event.organizer_id,
                "description":      exception.description,
                "is_public":        root_event.is_public,
                "color":            exception.color or root_event.color,
                "kind_name":        (exception.event_kind or root_event.event_kind).name if (exception.event_kind or root_event.event_kind) else None,
                "kind_color":       (exception.event_kind or root_event.event_kind).color if (exception.event_kind or root_event.event_kind) else None,
                "event_kind_id":    exception.event_kind_id or root_event.event_kind_id,
                "group_ids":        groups_by_event.get(root_event.id, []),
                "venues":           _exc_venues(exception),
                "venue_ids":        _exc_venue_ids(exception),
                "is_recurring":     True,
                "is_exception":     True,
                "original_time":    original_iso,
                "rrule":            rule.rrule,
                "series_start":     root_event.start_time.isoformat(),
                "series_end":       rule.end_date.isoformat() if rule.end_date else None,
            })

        for occ in occurrences:
            occ_start = occ["start"]   # ISO string
            occ_end   = occ["end"]     # ISO string
            occ_dt_naive = to_utc_naive(datetime.fromisoformat(occ_start))
            exception = exception_map.get(occ_dt_naive)

            if exception:
                # This RRULE slot is overridden by an exception.
                if exception.status == EventStatus.CANCELLED:
                    continue   # cancelled → gone from the calendar
                ex_s = to_utc_naive(exception.start_time)
                ex_e = to_utc_naive(exception.end_time)
                if ex_s < w_end and ex_e > w_start:
                    # its ACTUAL (edited) time falls in this window → render it here
                    _emit_exception(exception, occ_start)
                # else: moved OUT of this window — suppress the slot here; it renders
                #       in the window it moved TO (the second pass over there).
            else:
                # ── No exception — normal RRULE-generated occurrence ──
                result.append({
                    "id":               root_event.id,
                    "title":            root_event.title,
                    "start":            occ_start,
                    "end":              occ_end,
                    "status":           root_event.status.value,
                    "booking_statuses": booking_statuses,
                    "is_mine":          (not is_anon) and root_event.organizer_id == actor.id,
                    "organizer_id":     None if is_anon else root_event.organizer_id,
                    "description":      root_event.description,
                    "is_public":        root_event.is_public,
                    "color":            root_event.color,
                    "kind_name":        root_event.event_kind.name if root_event.event_kind else None,
                    "kind_color":       root_event.event_kind.color if root_event.event_kind else None,
                    "event_kind_id":    root_event.event_kind_id,
                    "group_ids":        groups_by_event.get(root_event.id, []),
                    "venues":           _venues_of(template_bookings),
                    "venue_ids":        _ids_of(template_bookings),
                    "is_recurring":     True,
                    "is_exception":     False,
                    "rrule":            rule.rrule,
                    "series_start":     root_event.start_time.isoformat(),
                    "series_end":       rule.end_date.isoformat() if rule.end_date else None,
                })

        # Second pass — occurrences MOVED INTO this window from an out-of-window
        # original slot (so the RRULE loop above never produced them). Render each
        # at its actual time; skip any already emitted (original slot also in-window)
        # and cancelled ones.
        for exc in exceptions:
            if exc.id in emitted_exc or exc.status == EventStatus.CANCELLED or exc.start_time is None:
                continue
            ex_s = to_utc_naive(exc.start_time)
            ex_e = to_utc_naive(exc.end_time)
            if ex_s < w_end and ex_e > w_start:
                _emit_exception(exc, exc.occurrence_date.isoformat() if exc.occurrence_date is not None else exc.start_time.isoformat())

    # Sort combined result by start time ascending
    result.sort(key=lambda x: x["start"])
    return result





BookingService.get_calendar_events = _get_calendar_events


# Attach new methods
BookingService.update_event    = _update_event
BookingService.cancel_event    = _cancel_event
BookingService.get_event_detail = _get_event_detail
BookingService.get_calendar_events = _get_calendar_events
BookingService.edit_occurrence = _edit_occurrence
BookingService.cancel_occurrence = _cancel_occurrence