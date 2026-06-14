"""
NotificationService — reacts to domain events via the event bus.

This module is NEVER imported by BookingService or EventService.
Instead, it registers handlers with the bus at startup.

This is the event-driven pattern: producers don't know consumers exist.
Future: replace bus.subscribe with a Redis/Celery task queue for async delivery.
"""

from sqlalchemy.orm import Session
from app.modules.models import Notification, NotificationType, User, Booking, SlotReleaseRequest, Event, Resource
from app.core.events import bus
from app.core.database import SessionLocal


def _get_db() -> Session:
    """Get a fresh DB session for event handlers (they run outside request context)."""
    return SessionLocal()


def _notify(db: Session, recipient_id: str, ntype: NotificationType, title: str, message: str,
            booking_id=None, event_id=None):
    n = Notification(
        recipient_id=recipient_id,
        notification_type=ntype,
        title=title,
        message=message,
        related_booking_id=booking_id,
        related_event_id=event_id,
    )
    db.add(n)
    db.commit()


def on_booking_pending(payload: dict):
    db = _get_db()
    try:
        booking = db.query(Booking).filter(Booking.id == payload["booking_id"]).first()
        if not booking:
            return
        # Notify the requester their booking is pending approval
        _notify(
            db, booking.requester_id,
            NotificationType.BOOKING_PENDING,
            "Booking Submitted",
            f"Your booking is pending approval.",
            booking_id=booking.id,
        )
    finally:
        db.close()


def on_booking_confirmed(payload: dict):
    db = _get_db()
    try:
        booking = db.query(Booking).filter(Booking.id == payload.get("booking_id")).first()
        if not booking:
            return
        _notify(
            db, booking.requester_id,
            NotificationType.BOOKING_CONFIRMED,
            "Booking Confirmed",
            f"Your booking has been confirmed.",
            booking_id=booking.id,
        )
    finally:
        db.close()


def on_booking_approved(payload: dict):
    db = _get_db()
    try:
        booking = db.query(Booking).filter(Booking.id == payload.get("booking_id")).first()
        if not booking:
            return
        _notify(
            db, booking.requester_id,
            NotificationType.BOOKING_CONFIRMED,
            "Booking Approved",
            f"Your booking has been approved.",
            booking_id=booking.id,
        )
    finally:
        db.close()


def on_booking_rejected(payload: dict):
    db = _get_db()
    try:
        booking = db.query(Booking).filter(Booking.id == payload.get("booking_id")).first()
        if not booking:
            return
        _notify(
            db, booking.requester_id,
            NotificationType.BOOKING_REJECTED,
            "Booking Rejected",
            f"Your booking request was rejected.",
            booking_id=booking.id,
        )
    finally:
        db.close()


def on_booking_cancelled(payload: dict):
    db = _get_db()
    try:
        booking = db.query(Booking).filter(Booking.id == payload.get("booking_id")).first()
        if not booking:
            return
        _notify(
            db, booking.requester_id,
            NotificationType.BOOKING_CANCELLED,
            "Booking Cancelled",
            f"Your booking has been cancelled.",
            booking_id=booking.id,
        )
    finally:
        db.close()


def on_release_requested(payload: dict):
    db = _get_db()
    try:
        req = db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == payload.get("request_id")).first()
        if not req:
            return
        # enrich the holder's notification with who/where/when (pulled from the
        # held booking + the requester), so the alert is self-explanatory.
        requester = db.query(User).filter(User.id == req.requester_id).first()
        booking = db.query(Booking).filter(Booking.id == req.booking_id).first()
        resource = db.query(Resource).filter(Resource.id == booking.resource_id).first() if booking else None
        who = requester.full_name if requester else "Someone"
        room = resource.name if resource else "a room"
        when = ""
        if booking is not None:
            try:
                when = f" — {booking.start_time.strftime('%b %d, %H:%M')}–{booking.end_time.strftime('%H:%M')}"
            except Exception:
                when = ""
        _notify(
            db, req.holder_id, NotificationType.EVENT_UPDATED,
            f"Slot request: {room}",
            f"{who} requested {room}{when}. Open Slot Requests to accept, move or decline.",
            booking_id=req.booking_id,
        )
    finally:
        db.close()


def on_release_accepted(payload: dict):
    db = _get_db()
    try:
        req = db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == payload.get("request_id")).first()
        if not req:
            return
        _notify(
            db, req.requester_id, NotificationType.EVENT_UPDATED,
            "Slot request accepted",
            "Your slot request was accepted — the slot is now free to book.",
            booking_id=req.booking_id,
        )
    finally:
        db.close()


def on_release_declined(payload: dict):
    db = _get_db()
    try:
        req = db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == payload.get("request_id")).first()
        if not req:
            return
        _notify(
            db, req.requester_id, NotificationType.EVENT_UPDATED,
            "Slot request declined",
            "Your slot request was declined.",
            booking_id=req.booking_id,
        )
    finally:
        db.close()


def on_event_created(payload: dict):
    """Someone scheduled a new event — tell every other active user, with the
    event's details, so faculty see each other's new bookings without reloading."""
    db = _get_db()
    try:
        event = db.query(Event).filter(Event.id == payload.get("event_id")).first()
        if not event:
            return
        organizer = db.query(User).filter(User.id == event.organizer_id).first()
        who = organizer.full_name if organizer else "Someone"
        try:
            when = event.start_time.strftime("%b %d, %H:%M")
        except Exception:
            when = ""
        # everyone except the creator (and only active accounts)
        recipients = db.query(User).filter(
            User.id != event.organizer_id,
            User.is_active == True,  # noqa: E712
        ).all()
        for r in recipients:
            n = Notification(
                recipient_id=r.id,
                notification_type=NotificationType.EVENT_UPDATED,
                title=f"New event: {event.title}",
                message=f"{who} scheduled “{event.title}” on {when}." if when
                        else f"{who} scheduled “{event.title}”.",
                related_event_id=event.id,
            )
            db.add(n)
        db.commit()
    finally:
        db.close()


def register_handlers():
    """Called once at app startup. Wires domain events → notification handlers."""
    bus.subscribe("booking.pending", on_booking_pending)
    bus.subscribe("event.created", on_event_created)
    bus.subscribe("booking.confirmed", on_booking_confirmed)
    bus.subscribe("booking.approved", on_booking_approved)
    bus.subscribe("booking.rejected", on_booking_rejected)
    bus.subscribe("booking.cancelled", on_booking_cancelled)
    bus.subscribe("release.requested", on_release_requested)
    bus.subscribe("release.accepted", on_release_accepted)
    bus.subscribe("release.declined", on_release_declined)
