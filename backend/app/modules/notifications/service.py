"""
NotificationService — reacts to domain events via the event bus.

This module is NEVER imported by BookingService or EventService.
Instead, it registers handlers with the bus at startup.

This is the event-driven pattern: producers don't know consumers exist.
Future: replace bus.subscribe with a Redis/Celery task queue for async delivery.
"""

from sqlalchemy.orm import Session
from app.modules.models import Notification, NotificationType, User, Booking
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


def register_handlers():
    """Called once at app startup. Wires domain events → notification handlers."""
    bus.subscribe("booking.pending", on_booking_pending)
    bus.subscribe("booking.confirmed", on_booking_confirmed)
    bus.subscribe("booking.approved", on_booking_approved)
    bus.subscribe("booking.rejected", on_booking_rejected)
    bus.subscribe("booking.cancelled", on_booking_cancelled)
