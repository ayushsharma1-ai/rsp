"""
Domain Models — the schema embodies the domain language.

Key design decisions explained inline:
- User/Role: RBAC foundation, extensible to ABAC later
- Resource: generic abstraction (not "Classroom"), typed via ResourceType
- Event vs Booking: separated intentionally
  * Event = what is happening (meeting, lecture)
  * Booking = a reservation claim on a Resource for a time window
  * One Event can have many Bookings (multiple resources)
- RecurrenceRule: stored as RFC 5545 RRULE string to avoid row explosion
- BookingStatus: finite state machine modeled as enum
- Notification: decoupled, event-driven population
- AuditLog: append-only, never updated
"""

import uuid
import enum
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, DateTime, ForeignKey,
    Enum as SAEnum, Text, Integer, UniqueConstraint, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


def new_uuid():
    return str(uuid.uuid4())


# ─────────────────────────────────────────────
# IDENTITY & ACCESS MODULE
# ─────────────────────────────────────────────

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    PROFESSOR = "professor"
    STAFF = "staff"
    VIEWER = "viewer"


class User(Base):
    """
    Central identity entity. Roles kept simple for MVP.
    Future: extract to Identity Provider, support OAuth2, SAML.
    """
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.VIEWER)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    owned_events = relationship("Event", back_populates="organizer", foreign_keys="Event.organizer_id")
    bookings = relationship("Booking", back_populates="requester", foreign_keys="Booking.requester_id")
    notifications = relationship("Notification", back_populates="recipient")
    audit_logs = relationship("AuditLog", back_populates="actor")


# ─────────────────────────────────────────────
# RESOURCES MODULE
# ─────────────────────────────────────────────

class ResourceType(str, enum.Enum):
    """
    Why enum and not a free-form string?
    Controlled vocabulary prevents drift ("Lab" vs "lab" vs "Laboratory").
    New types added here — never hardcoded in business logic.
    """
    CLASSROOM = "classroom"
    LAB = "lab"
    COMPUTER_ROOM = "computer_room"
    SEMINAR_HALL = "seminar_hall"
    MEETING_ROOM = "meeting_room"
    EQUIPMENT = "equipment"
    OTHER = "other"


class Resource(Base):
    """
    Generic resource abstraction.
    Deliberately NOT "Classroom" — this lets labs, equipment, rooms
    all live under one booking system without separate tables.

    capacity: nullable because equipment may not have seats
    requires_approval: per-resource policy (some rooms auto-approve, others need admin sign-off)
    """
    __tablename__ = "resources"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    resource_type = Column(SAEnum(ResourceType), nullable=False)
    location = Column(String(255), nullable=True)
    capacity = Column(Integer, nullable=True)
    requires_approval = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    bookings = relationship("Booking", back_populates="resource")

    __table_args__ = (
        Index("ix_resources_type", "resource_type"),
    )


# ─────────────────────────────────────────────
# SCHEDULING MODULE — Events
# ─────────────────────────────────────────────

class RecurrenceRule(Base):
    """
    Why a separate table and not inline columns?

    Option A (naive): store day_of_week, frequency, interval on Event.
      Problem: Limited expressiveness. Can't handle "last Thursday of month".

    Option B (this): store RFC 5545 RRULE string.
      "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=1;COUNT=20"
      Pros: industry-standard, handles all recurrence patterns,
            libraries exist (python-dateutil rrulestr), future-proof.
      Cons: harder to query directly in SQL (handled in app layer).

    Separating into its own entity because:
    - Not all events recur (optional relationship)
    - Rule can be reused/referenced
    - Exceptions (edited single occurrences) attach here
    """
    __tablename__ = "recurrence_rules"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    rrule = Column(String(500), nullable=False)  # RFC 5545 RRULE string
    start_date = Column(DateTime(timezone=True), nullable=False)
    end_date = Column(DateTime(timezone=True), nullable=True)  # null = no end

    events = relationship("Event", back_populates="recurrence_rule")


class EventStatus(str, enum.Enum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"


class EventCategory(str, enum.Enum):
    """Phase 5 — separate the fixed academic timetable from one-off ad-hoc events."""
    ACADEMIC = "academic"   # regular coursework / fixed timetable (the baseline)
    ADHOC = "adhoc"         # new one-off events people create


class Event(Base):
    """
    An Event is WHAT is happening — a meeting, lecture, seminar.
    It is NOT the resource reservation itself (that's a Booking).

    Why separate Event from Booking?
    - A lecture can be rescheduled (event metadata changes) without changing the room booking concept
    - One event may book multiple resources (room + projector + lab)
    - Event cancellation cascades to bookings but they're distinct lifecycle concepts
    - Future: events can exist without resource bookings (virtual meetings)

    recurrence_rule_id: nullable — only set for recurring events.
    parent_event_id: for "exception" occurrences in a recurring series.
      When a user edits a single occurrence of a weekly meeting,
      we create a new Event with parent_event_id pointing to the series root.
      This avoids mutating the entire series.
    """
    __tablename__ = "events"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    organizer_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    status = Column(SAEnum(EventStatus), default=EventStatus.CONFIRMED, nullable=False)

    # Recurrence
    recurrence_rule_id = Column(UUID(as_uuid=False), ForeignKey("recurrence_rules.id"), nullable=True)
    parent_event_id = Column(UUID(as_uuid=False), ForeignKey("events.id"), nullable=True)
    occurrence_date = Column(DateTime(timezone=True), nullable=True)  # which occurrence this exception replaces

    is_public = Column(Boolean, default=True, nullable=False)
    is_recurring_root = Column(Boolean, default=False, nullable=False)
    category = Column(SAEnum(EventCategory), default=EventCategory.ADHOC, nullable=False)
    color = Column(String(9), nullable=True)  # optional user-chosen hex (e.g. "#5b6ef5"); null = default venue color
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    organizer = relationship("User", back_populates="owned_events", foreign_keys=[organizer_id])
    recurrence_rule = relationship("RecurrenceRule", back_populates="events")
    bookings = relationship("Booking", back_populates="event", cascade="all, delete-orphan")
    participants = relationship("EventParticipant", back_populates="event", cascade="all, delete-orphan")
    parent_event = relationship("Event", remote_side="Event.id", foreign_keys=[parent_event_id])

    __table_args__ = (
        Index("ix_events_organizer", "organizer_id"),
        Index("ix_events_start_time", "start_time"),
        Index("ix_events_recurrence", "recurrence_rule_id"),
    )


class EventParticipant(Base):
    """
    Many-to-many: Event ↔ User.
    Separate table to track RSVP status and role in event.
    """
    __tablename__ = "event_participants"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    event_id = Column(UUID(as_uuid=False), ForeignKey("events.id"), nullable=False)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    rsvp_status = Column(String(20), default="pending")  # pending, accepted, declined

    event = relationship("Event", back_populates="participants")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_event_participant"),
    )


# ─────────────────────────────────────────────
# BOOKING MODULE
# ─────────────────────────────────────────────

class BookingStatus(str, enum.Enum):
    """
    Finite state machine for booking lifecycle.

    PENDING → APPROVED or REJECTED (if requires_approval)
    PENDING → CONFIRMED (if auto-approve)
    CONFIRMED → CANCELLED
    APPROVED → CONFIRMED → CANCELLED

    Why model as enum FSM rather than boolean flags?
    - States are mutually exclusive
    - Transitions are explicit (enforced in service layer)
    - Future states (WAITLISTED, NEGOTIATING) slot in cleanly
    """
    PENDING = "pending"
    APPROVED = "approved"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class Booking(Base):
    """
    A Booking is a claim on a Resource for a time window, linked to an Event.

    Why store start_time/end_time ON Booking (not just reference Event's times)?
    - Resource reservation time may differ from event time
      (setup/teardown: room booked 30min before lecture)
    - Partial resource use is possible
    - Decouples resource scheduling from event scheduling

    Conflict prevention:
    - EXCLUDE constraint (PostgreSQL range type) is ideal for production
    - For MVP: checked at service layer with SELECT FOR UPDATE
    - See BookingService for the advisory lock pattern
    """
    __tablename__ = "bookings"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    event_id = Column(UUID(as_uuid=False), ForeignKey("events.id"), nullable=False)
    resource_id = Column(UUID(as_uuid=False), ForeignKey("resources.id"), nullable=False)
    requester_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    status = Column(SAEnum(BookingStatus), default=BookingStatus.PENDING, nullable=False)
    notes = Column(Text, nullable=True)
    reviewed_by_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_recurring_template = Column(Boolean, default=False, nullable=False)
    recurrence_rule_id = Column(UUID(as_uuid=False), ForeignKey("recurrence_rules.id"), nullable=True)

    # Relationships
    event = relationship("Event", back_populates="bookings")
    resource = relationship("Resource", back_populates="bookings")
    requester = relationship("User", back_populates="bookings", foreign_keys=[requester_id])
    recurrence_rule = relationship("RecurrenceRule")
    reviewer = relationship("User", foreign_keys=[reviewed_by_id])

    __table_args__ = (
        Index("ix_bookings_resource_time", "resource_id", "start_time", "end_time"),
        Index("ix_bookings_status", "status"),
        Index("ix_bookings_requester", "requester_id"),
    )


# ─────────────────────────────────────────────
# NOTIFICATIONS MODULE
# ─────────────────────────────────────────────

class NotificationType(str, enum.Enum):
    BOOKING_CONFIRMED = "booking_confirmed"
    BOOKING_REJECTED = "booking_rejected"
    BOOKING_PENDING = "booking_pending"
    BOOKING_CANCELLED = "booking_cancelled"
    EVENT_UPDATED = "event_updated"
    EVENT_CANCELLED = "event_cancelled"
    REMINDER = "reminder"


class Notification(Base):
    """
    Populated by the event bus, NOT by direct service calls.
    NotificationService subscribes to domain events and writes here.

    Why decouple?
    - BookingService doesn't need to know HOW to notify
    - Notification channel (email, push, SMS) can change without touching booking logic
    - Future: async worker reads this table and delivers notifications
    """
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    recipient_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)
    notification_type = Column(SAEnum(NotificationType), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    related_booking_id = Column(UUID(as_uuid=False), ForeignKey("bookings.id"), nullable=True)
    related_event_id = Column(UUID(as_uuid=False), ForeignKey("events.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    recipient = relationship("User", back_populates="notifications")

    __table_args__ = (
        Index("ix_notifications_recipient_read", "recipient_id", "is_read"),
    )


# ─────────────────────────────────────────────
# AUDIT LOG MODULE
# ─────────────────────────────────────────────

class AuditLog(Base):
    """
    Append-only audit trail. NEVER updated or deleted.

    Why a separate audit table vs soft-deletes or updated_at?
    - Immutable history: who did what, when, on what
    - Compliance requirements (who approved which booking)
    - Debugging production issues
    - Future analytics over user behavior

    entity_type + entity_id: polymorphic reference (avoids separate audit tables per domain).
    old_values/new_values: JSON snapshots (Text for MVP, JSONB for production PostgreSQL).
    """
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    actor_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)  # null = system
    action = Column(String(100), nullable=False)  # "booking.created", "booking.approved"
    entity_type = Column(String(100), nullable=False)  # "Booking", "Event", "Resource"
    entity_id = Column(String(255), nullable=False)
    old_values = Column(Text, nullable=True)   # JSON snapshot
    new_values = Column(Text, nullable=True)   # JSON snapshot
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    actor = relationship("User", back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_actor", "actor_id"),
        Index("ix_audit_created", "created_at"),
    )

# ----------------------------
# Feedback
#-----------------------------
class FeedbackCategory(str, enum.Enum):
    BUG         = "bug"
    SUGGESTION  = "suggestion"
    QUESTION    = "question"
    OTHER       = "other"


class Feedback(Base):
    """
    User feedback submitted via the in-app widget.
    Append-only — never updated or deleted.
    """
    __tablename__ = "feedback"

    id           = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    user_id      = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    message      = Column(Text, nullable=False)
    category     = Column(SAEnum(FeedbackCategory), default=FeedbackCategory.OTHER, nullable=False)
    page_url     = Column(String(500), nullable=True)
    page_name    = Column(String(100), nullable=True)
    browser      = Column(String(255), nullable=True)
    submitted_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        Index("ix_feedback_user", "user_id"),
        Index("ix_feedback_submitted", "submitted_at"),
    )


# ─────────────────────────────────────────────
# GROUPS & ROSTER MODULE (Phase 2)
# ─────────────────────────────────────────────
# Why these tables?
#   The meeting wants clash detection on STUDENTS, not just rooms. We model
#   students as lightweight "roster people" collected into "groups" (e.g.
#   "First-year CS"). An Event targets one or more groups. Clash on students =
#   "do two events' rosters share anyone?" — computed by expanding groups -> people.
#
#   This is the textbook MANY-TO-MANY pattern, done with JUNCTION tables:
#     groups  <--(group_members)-->  roster_people      (a person is in many groups; a group has many people)
#     events  <--(event_groups)  -->  groups            (an event targets many groups; a group is used by many events)

class RosterPerson(Base):
    """
    A lightweight person — usually a student. NOT necessarily an app User.
    Just a name + optional email, with an optional link to a real User account
    if that person ever signs in. This lets us roster a whole cohort without
    forcing 100 logins.
    """
    __tablename__ = "roster_people"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    full_name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)  # optional link to a real account
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", foreign_keys=[user_id])
    memberships = relationship("GroupMember", back_populates="person", cascade="all, delete-orphan")


class Group(Base):
    """A named roster of people, e.g. 'First-year CS' or 'B.Des 2025'."""
    __tablename__ = "groups"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    group_type = Column(String(50), nullable=True)   # free-form: cohort / section / year / ...
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    members = relationship("GroupMember", back_populates="group", cascade="all, delete-orphan")
    event_links = relationship("EventGroup", back_populates="group", cascade="all, delete-orphan")


class GroupMember(Base):
    """
    JUNCTION table for the many-to-many between Group and RosterPerson.
    One row = "this person is in this group." The unique constraint stops the
    same person being added to one group twice.
    """
    __tablename__ = "group_members"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id"), nullable=False)
    roster_person_id = Column(UUID(as_uuid=False), ForeignKey("roster_people.id"), nullable=False)

    group = relationship("Group", back_populates="members")
    person = relationship("RosterPerson", back_populates="memberships")

    __table_args__ = (
        UniqueConstraint("group_id", "roster_person_id", name="uq_group_member"),
        Index("ix_group_members_group", "group_id"),
        Index("ix_group_members_person", "roster_person_id"),
    )


class EventGroup(Base):
    """
    JUNCTION table for the many-to-many between Event and Group.
    One row = "this event is for this group."
    """
    __tablename__ = "event_groups"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    event_id = Column(UUID(as_uuid=False), ForeignKey("events.id"), nullable=False)
    group_id = Column(UUID(as_uuid=False), ForeignKey("groups.id"), nullable=False)

    event = relationship("Event")
    group = relationship("Group", back_populates="event_links")

    __table_args__ = (
        UniqueConstraint("event_id", "group_id", name="uq_event_group"),
        Index("ix_event_groups_event", "event_id"),
        Index("ix_event_groups_group", "group_id"),
    )


# ─────────────────────────────────────────────
# REQUEST-RELEASE MODULE (Phase 3)
# ─────────────────────────────────────────────

class ReleaseStatus(str, enum.Enum):
    """FSM for a slot-release request."""
    REQUESTED = "requested"
    ACCEPTED_RELEASED = "accepted_released"   # holder freed the slot
    ACCEPTED_MOVED = "accepted_moved"         # holder agreed to move it
    DECLINED = "declined"                     # holder said no
    CANCELLED = "cancelled"                   # requester withdrew


class SlotReleaseRequest(Base):
    """
    A requester asks the current holder of a booked slot to release (or move) it.
    The holder accepts in one tap (which frees the slot) or declines.
    Replaces the manual phone-call negotiation described in the meeting notes.
    """
    __tablename__ = "slot_release_requests"

    id = Column(UUID(as_uuid=False), primary_key=True, default=new_uuid)
    booking_id = Column(UUID(as_uuid=False), ForeignKey("bookings.id"), nullable=False)   # contested slot
    requester_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)    # who wants it
    holder_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False)       # current holder
    message = Column(Text, nullable=True)
    status = Column(SAEnum(ReleaseStatus), default=ReleaseStatus.REQUESTED, nullable=False)
    response_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    requested_event_json = Column(Text, nullable=True)            # the requester's intended event (JSON)
    created_event_id = Column(UUID(as_uuid=False), nullable=True)  # event auto-created when accepted

    booking = relationship("Booking", foreign_keys=[booking_id])
    requester = relationship("User", foreign_keys=[requester_id])
    holder = relationship("User", foreign_keys=[holder_id])

    __table_args__ = (
        Index("ix_release_holder", "holder_id", "status"),
        Index("ix_release_requester", "requester_id"),
    )
