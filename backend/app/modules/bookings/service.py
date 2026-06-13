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
from sqlalchemy import and_, or_
from pydantic import BaseModel
import json
from app.core.recurrence import check_recurring_conflict, expand_rrule

from app.modules.models import (
    Booking, BookingStatus, Resource, Event, User, AuditLog,
    Notification, NotificationType, EventStatus, EventGroup, EventCategory
)
from app.core.events import bus
from app.modules.availability.service import AvailabilityService
from app.modules.clash.service import ClashService


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
    color: Optional[str] = None        # v3: optional user-chosen hex color


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

        # Hard block on STUDENT clash (policy 2026-06-10): if this event's groups share any
        # students with another event at the same time, refuse it — pick a different slot.
        if data.group_ids:
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
        )
        self.db.add(event)
        self.db.flush()  # get event.id without committing

        for b in data.bookings:
            self._create_booking(event, b, actor)

        # Phase 2: link this event to the groups (cohorts) it targets, so clash
        # detection can expand event -> groups -> people later.
        for group_id in (data.group_ids or []):
            self.db.add(EventGroup(event_id=event.id, group_id=group_id))

        self._audit(actor, "event.created", "Event", event.id, None,
                    {"title": data.title, "start_time": str(data.start_time)})
        self.db.commit()
        self.db.refresh(event)
        bus.publish("event.created", {"event_id": event.id, "actor_id": actor.id})
        return event

    def _create_booking(self, event: Event, data: BookingCreate, actor: User) -> Booking:
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

        # Emit event for notification handler
        event_name = "booking.pending" if resource.requires_approval else "booking.confirmed"
        bus.publish(event_name, {
            "booking_id": booking.id,
            "resource_name": resource.name,
            "actor_id": actor.id,
        })

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
                detail=f"Cannot transition from {booking.status} to {new_status}"
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
            raise HTTPException(status_code=400, detail=f"Cannot cancel a {booking.status} booking")

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

        self._audit(actor, "recurring_event.created", "Event", event.id, None, {
            "title": title,
            "rrule": full_rrule,
            "occurrences_count": len(test_occurrences),
        })
        self.db.commit()

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
                                    exclude_template_id=None):
        """
        Does a recurring series clash with anything already in this room's schedule?

        `occurrences` = the (start, end) slots the series generates in
        [window_start, window_end]. We check each slot against:
          (a) existing one-off bookings, and
          (b) other recurring templates (expanded via their own rule).
        Returns a ready-to-show 409 message, or None if all clear.
        `exclude_template_id` skips the series' OWN template (used when editing it).
        """
        active = [BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.PENDING]

        # (a) vs one-off bookings overlapping the series window
        oneoffs = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == False,
            Booking.status.in_(active),
            Booking.start_time < window_end,
            Booking.end_time > window_start,
        ).all()
        for occ_s, occ_e in occurrences:
            for ex in oneoffs:
                if ex.start_time < occ_e and ex.end_time > occ_s:
                    return (f"Recurring series conflicts with an existing booking on "
                            f"{occ_s.strftime('%a, %b %d at %H:%M')}. Resolve that conflict first.")

        # (b) vs other recurring templates on the same resource
        others_q = self.db.query(Booking).filter(
            Booking.resource_id == resource_id,
            Booking.is_recurring_template == True,
            Booking.status.in_(active),
        )
        if exclude_template_id:
            others_q = others_q.filter(Booking.id != exclude_template_id)
        for other in others_q.all():
            if not other.recurrence_rule:
                continue
            other_duration = other.end_time - other.start_time
            for occ_s, occ_e in occurrences:
                hit = check_recurring_conflict(
                    rrule_string=other.recurrence_rule.rrule,
                    dtstart=other.start_time,
                    duration=other_duration,
                    requested_start=occ_s,
                    requested_end=occ_e,
                )
                if hit:
                    hs, he = hit
                    return (f"Recurring series conflicts with another recurring booking on "
                            f"{hs.strftime('%a, %b %d at %H:%M')}.")
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






def _edit_occurrence(
    self,
    root_event_id:   str,
    occurrence_date: datetime,   # which occurrence to edit (original slot)
    new_start:       datetime,   # new start time
    new_end:         datetime,   # new end time
    actor:           'User',
    new_title:       str = None,
    new_description: str = None,
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

    # Step 2 — validate the new times
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="end_time must be after start_time")

    # Step 3 — check for booking conflicts at the new time
    # The root event has a recurring template booking
    # We need to check if the new time conflicts with anything else
    # We skip the root event's own template (same resource, same series)
    # because the original slot will be suppressed anyway
    template_booking = self.db.query(Booking).filter(
        Booking.event_id == root_event_id,
        Booking.is_recurring_template == True,
        Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.APPROVED]),
    ).first()

    if template_booking:
        # Check one-off conflicts at the new time
        # SELECT * FROM bookings
        # WHERE resource_id = :resource_id
        # AND is_recurring_template = FALSE
        # AND status IN ('confirmed', 'approved', 'pending')
        # AND start_time < :new_end
        # AND end_time > :new_start
        conflict = self.db.query(Booking).filter(
            Booking.resource_id == template_booking.resource_id,
            Booking.is_recurring_template == False,
            Booking.status.in_([BookingStatus.CONFIRMED, BookingStatus.APPROVED, BookingStatus.PENDING]),
            Booking.start_time < new_end,
            Booking.end_time > new_start,
        ).first()

        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"New time conflicts with an existing booking "
                    f"from {conflict.start_time.strftime('%H:%M')} "
                    f"to {conflict.end_time.strftime('%H:%M')}"
            )

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
    )
    self.db.add(exception_event)

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
        if group_ids:
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
    color: Optional[str] = None        # v3: optional user-chosen hex color


def _update_event(self, event_id: str, data: 'EventUpdate', actor: 'User', occurrence_date: datetime = None) -> dict:
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if actor.role != UserRole.ADMIN and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if event.status == EventStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled event")

    # ── Recurring event + occurrence_date = edit one occurrence ──
    if event.is_recurring_root and occurrence_date:
        return self.edit_occurrence(
            root_event_id=event_id,
            occurrence_date=occurrence_date,
            new_start=data.start_time or event.start_time,
            new_end=data.end_time or event.end_time,
            actor=actor,
            new_title=data.title,
            new_description=data.description,
        )

    # ── Recurring event, no occurrence_date = edit entire series ─
    elif event.is_recurring_root and not occurrence_date:
        new_start = data.start_time or event.start_time
        new_end   = data.end_time   or event.end_time

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
                        tb.resource_id, new_occ, win_start, win_end, exclude_template_id=tb.id
                    )
                    if msg:
                        raise HTTPException(status_code=409, detail=msg)

        old = {"start_time": str(event.start_time), "end_time": str(event.end_time)}

        if data.start_time:      event.start_time   = data.start_time
        if data.end_time:        event.end_time      = data.end_time
        if data.title:           event.title         = data.title
        if data.description is not None: event.description = data.description
        if data.color is not None:       event.color       = data.color or None

        # Cascade to template booking
        for booking in event.bookings:
            if booking.is_recurring_template and booking.status not in (
                BookingStatus.CANCELLED, BookingStatus.REJECTED
            ):
                if data.start_time: booking.start_time = data.start_time
                if data.end_time:   booking.end_time   = data.end_time

        self._audit(actor, "recurring_series.updated", "Event", event_id, old, {
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

    # ── Normal one-off event ─────────────────────────────────────
    else:
        new_start = data.start_time or event.start_time
        new_end   = data.end_time   or event.end_time

        if new_end <= new_start:
            raise HTTPException(status_code=400, detail="end_time must be after start_time")

        if data.start_time or data.end_time:
            av = AvailabilityService(self.db)
            for b in event.bookings:
                if b.status in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                    continue
                conflict = av.find_conflict(
                    b.resource_id, new_start, new_end, lock=True, exclude_booking_id=b.id
                )
                if conflict:
                    raise HTTPException(status_code=409, detail=conflict.message)

            # Hard block on STUDENT clash when moving the event (policy 2026-06-10)
            group_ids = [eg.group_id for eg in
                         self.db.query(EventGroup).filter(EventGroup.event_id == event.id).all()]
            if group_ids:
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

        for booking in event.bookings:
            if booking.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED):
                if data.start_time: booking.start_time = data.start_time
                if data.end_time:   booking.end_time   = data.end_time

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


def _cancel_event(self, event_id: str, actor: 'User', occurrence_date: datetime = None) -> dict:
    from app.modules.models import UserRole

    event = self.db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if actor.role != UserRole.ADMIN and event.organizer_id != actor.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # ── Recurring series with no occurrence_date ──────────────
    # Frontend must use DELETE /events/{id}/series for this.
    # Returning a clear error prevents silent wrong behaviour.
    if event.is_recurring_root and not occurrence_date:
        raise HTTPException(
            status_code=400,
            detail="This is a recurring series. "
                   "To cancel one occurrence send occurrence_date. "
                   "To cancel the entire series use DELETE /events/{id}/series."
        )

    # ── Cancel one occurrence of a recurring series ───────────
    if event.is_recurring_root and occurrence_date:
        return self.cancel_occurrence(
            root_event_id=event_id,
            occurrence_date=occurrence_date,
            actor=actor,
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
    if actor.role != UserRole.ADMIN:
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
            "is_mine":          e.organizer_id == actor.id,
            "organizer_id":     e.organizer_id,
            "description":      e.description,
            "is_public":        e.is_public,
            "color":            e.color,
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
    if actor.role != UserRole.ADMIN:
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

        if not occurrences:
            continue

        # Fetch all exception rows for this series
        # An exception row has parent_event_id pointing to this root event
        # and occurrence_date identifying which generated slot it replaces
        exceptions = self.db.query(Event).filter(
            Event.parent_event_id == root_event.id,
        ).all()

        # Build a lookup: UTC naive datetime → exception Event object
        # Using UTC naive datetimes as keys avoids timezone string
        # serialisation mismatches (e.g. "+00:00" vs "Z" vs microseconds)
        exception_map = {}
        for exc in exceptions:
            if exc.occurrence_date is not None:
                key = to_utc_naive(exc.occurrence_date)
                exception_map[key] = exc

        # Template booking status — same for all occurrences in the series
        template_bookings = [
            b for b in root_event.bookings
            if b.is_recurring_template
            and b.status not in (BookingStatus.CANCELLED, BookingStatus.REJECTED)
        ]
        booking_statuses = list({b.status.value for b in template_bookings})

        for occ in occurrences:
            occ_start = occ["start"]   # ISO string
            occ_end   = occ["end"]     # ISO string

            # Convert ISO string back to UTC naive datetime for map lookup
            occ_dt       = datetime.fromisoformat(occ_start)
            occ_dt_naive = to_utc_naive(occ_dt)

            # Check if an exception exists for this specific occurrence
            exception = exception_map.get(occ_dt_naive)

            if exception:
                # ── Exception exists for this date ────────────────────

                if exception.status == EventStatus.CANCELLED:
                    # Occurrence was cancelled — skip entirely
                    # It will not appear on the calendar at all
                    continue

                # Occurrence was edited — show exception's times and details
                # instead of the RRULE-generated slot
                result.append({
                    "id":               root_event.id,
                    "exception_id":     exception.id,
                    "title":            exception.title,
                    "start":            exception.start_time.isoformat(),
                    "end":              exception.end_time.isoformat(),
                    "status":           exception.status.value,
                    "booking_statuses": booking_statuses,
                    "is_mine":          root_event.organizer_id == actor.id,
                    "organizer_id":     root_event.organizer_id,
                    "description":      exception.description,
                    "is_public":        root_event.is_public,
                    "color":            exception.color or root_event.color,
                    "is_recurring":     True,
                    "is_exception":     True,
                    "original_time":    occ_start,
                    "rrule":            rule.rrule,
                    "series_start":     root_event.start_time.isoformat(),
                    "series_end":       rule.end_date.isoformat() if rule.end_date else None,
                })

            else:
                # ── No exception — normal RRULE-generated occurrence ──

                result.append({
                    "id":               root_event.id,
                    "title":            root_event.title,
                    "start":            occ_start,
                    "end":              occ_end,
                    "status":           root_event.status.value,
                    "booking_statuses": booking_statuses,
                    "is_mine":          root_event.organizer_id == actor.id,
                    "organizer_id":     root_event.organizer_id,
                    "description":      root_event.description,
                    "is_public":        root_event.is_public,
                    "color":            root_event.color,
                    "is_recurring":     True,
                    "is_exception":     False,
                    "rrule":            rule.rrule,
                    "series_start":     root_event.start_time.isoformat(),
                    "series_end":       rule.end_date.isoformat() if rule.end_date else None,
                })

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