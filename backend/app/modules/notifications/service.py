"""
NotificationService — reacts to domain events via the event bus.

This module is NEVER imported by BookingService or EventService.
Instead, it registers handlers with the bus at startup.

This is the event-driven pattern: producers don't know consumers exist.
Future: replace bus.subscribe with a Redis/Celery task queue for async delivery.
"""

from sqlalchemy.orm import Session
from app.modules.models import Notification, NotificationType, User, Booking, SlotReleaseRequest, Event, Resource, UserRole
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


# ── Notification copy ─────────────────────────────────────────────────────────
# The second line must carry FACTS, never a restatement of the title. Every booking
# notification used to read "Booking Confirmed" / "Your booking has been confirmed." —
# twice the words for none of the information, which is what made the Activity list
# look like paragraphs of prose instead of a scannable list. The title says what
# happened; this says which booking it happened to.
def _booking_line(booking) -> str:
    bits = []
    res = getattr(booking, "resource", None)
    if res is not None and getattr(res, "name", None):
        bits.append(res.name)
    st = getattr(booking, "start_time", None)
    if st is not None:
        # "Mon 3 Aug, 10:30 AM" — weekday included because a booking is almost always
        # discussed by weekday ("the Monday slot"), and it costs three characters.
        # Built by hand rather than with strftime: the no-pad directives differ by
        # platform (%-d on Linux, %#d on Windows) and this runs on both — dev here,
        # Linux on the VM. Explicit ints are the same everywhere.
        hour12 = st.hour % 12 or 12
        meridiem = "AM" if st.hour < 12 else "PM"
        bits.append(f"{st:%a} {st.day} {st:%b}, {hour12}:{st.minute:02d} {meridiem}")
    return " · ".join(bits) if bits else "Open Scheduler for details."


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
            "Booking submitted",
            _booking_line(booking),
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
            "Booking confirmed",
            _booking_line(booking),
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
            "Booking approved",
            _booking_line(booking),
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
            "Booking rejected",
            _booking_line(booking),
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
            "Booking cancelled",
            _booking_line(booking),
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
        # Show the DATE the requester actually asked for. For a recurring event the
        # booking's own start_time is the SERIES ANCHOR (its first occurrence, e.g.
        # Aug 14), not the contested date (Aug 31) — that lives in the proposed
        # event, exactly as _to_out uses for the Slot Requests screen.
        when = ""
        # Pinned display zone (settings.APP_TIMEZONE, default Asia/Kolkata) so the
        # requested time reads correctly regardless of the DB/host ambient timezone.
        # Falls back to the held booking's own offset if the name can't be resolved.
        try:
            from zoneinfo import ZoneInfo
            from app.core.config import settings
            tz = ZoneInfo(settings.APP_TIMEZONE)
        except Exception:
            tz = booking.start_time.tzinfo if (booking is not None and booking.start_time is not None) else None
        slot_s = slot_e = None
        if req.requested_event_json:
            try:
                import json as _json
                from datetime import datetime as _dt
                pe = _json.loads(req.requested_event_json)
                if pe.get("start_time"):
                    slot_s = _dt.fromisoformat(pe["start_time"].replace("Z", "+00:00"))
                    if tz is not None:
                        slot_s = slot_s.astimezone(tz)
                if pe.get("end_time"):
                    slot_e = _dt.fromisoformat(pe["end_time"].replace("Z", "+00:00"))
                    if tz is not None:
                        slot_e = slot_e.astimezone(tz)
            except Exception:
                slot_s = slot_e = None
        if slot_s is None and booking is not None:
            slot_s, slot_e = booking.start_time, booking.end_time
        if slot_s is not None:
            try:
                when = f" — {slot_s.strftime('%b %d, %H:%M')}" + (f"–{slot_e.strftime('%H:%M')}" if slot_e is not None else "")
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
        # The requester's event is created automatically on accept, so say what
        # actually happened instead of telling them to go and book it themselves.
        # response_note is set only when the auto-create couldn't be completed.
        _notify(
            db, req.requester_id, NotificationType.EVENT_UPDATED,
            "Slot request accepted",
            req.response_note or (
                "Your slot request was accepted — your event is on the calendar."
                if req.created_event_id
                # NOT "the slot is now free to book": free is a claim about a shared
                # resource at the instant of writing, and this can be read much later.
                # Somebody else may hold it by then, so send them to look rather than
                # promising what they'll find.
                else "Your slot request was accepted — open Scheduler to book the slot."
            ),
            # Deep-link to the requester's OWN new event when one was auto-created, so
            # tapping the alert jumps to their event, not the holder's old booking.
            booking_id=None if req.created_event_id else req.booking_id,
            event_id=req.created_event_id,
        )
    finally:
        db.close()


def on_release_declined(payload: dict):
    db = _get_db()
    try:
        req = db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == payload.get("request_id")).first()
        if not req:
            return
        # Also fires for requests auto-closed because the holder accepted someone
        # else's. Those carry no response_note on purpose — naming a "winner" was
        # both noisy and, when the holder picked a later asker, untrue. The status
        # plus this notification is the whole message. A note is still shown if the
        # holder declined explicitly and left a reason.
        _notify(
            db, req.requester_id, NotificationType.EVENT_UPDATED,
            "Slot request declined",
            req.response_note or "Your slot request was declined.",
            booking_id=req.booking_id,
        )
    finally:
        db.close()


def _broadcast_recipients(db, event):
    """Who may be told this event exists.

    Public event -> every other active user (that is the point of the broadcast:
    faculty see that a room is now taken). PRIVATE event -> admins only, matching
    the promise the create sheet makes ("Only you and admins can see it") and the
    rule get_event_detail already enforces. Without this split the title of a
    private event landed in every user's Activity feed.
    """
    q = db.query(User).filter(
        User.id != event.organizer_id,
        User.is_active == True,  # noqa: E712
    )
    if not getattr(event, "is_public", True):
        q = q.filter(User.role == UserRole.ADMIN)
    return q.all()


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
        # A recurring series broadcasts its FIRST occurrence's date; say so, so faculty
        # don't read "on Aug 14" as a one-off when it actually repeats weekly.
        recurs = bool(getattr(event, "is_recurring_root", False))
        when_txt = (f"{when} (recurring)" if (when and recurs)
                    else ("recurring" if recurs else when))
        # If the room booking still needs admin approval, say so — otherwise the
        # broadcast reads as "it's booked" when the slot isn't actually secured yet.
        try:
            pending = any(getattr(b.status, "value", b.status) == "pending"
                          for b in (event.bookings or []))
        except Exception:
            pending = False
        pend_txt = " — pending room approval" if pending else ""
        base = f"{who} scheduled “{event.title}”"
        msg = (f"{base} on {when_txt}{pend_txt}." if when_txt else f"{base}{pend_txt}.")
        # everyone except the creator (and only active accounts)
        recipients = _broadcast_recipients(db, event)
        for r in recipients:
            n = Notification(
                recipient_id=r.id,
                notification_type=NotificationType.EVENT_UPDATED,
                title=f"New event: {event.title}",
                message=msg,
                related_event_id=event.id,
            )
            db.add(n)
        db.commit()
    finally:
        db.close()


def on_event_cancelled(payload: dict):
    """An event was cancelled — tell every other active user, so faculty know the
    slot is free again (mirror of on_event_created). event.cancelled was already being
    published by the booking service, but nothing subscribed to it, so cancellations
    silently notified no one."""
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
        recipients = _broadcast_recipients(db, event)
        for r in recipients:
            n = Notification(
                recipient_id=r.id,
                notification_type=NotificationType.EVENT_UPDATED,
                title=f"Cancelled: {event.title}",
                message=(f"{who} cancelled “{event.title}” ({when}) — the slot is free again."
                         if when else f"{who} cancelled “{event.title}”."),
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
    bus.subscribe("event.cancelled", on_event_cancelled)
    bus.subscribe("booking.confirmed", on_booking_confirmed)
    bus.subscribe("booking.approved", on_booking_approved)
    bus.subscribe("booking.rejected", on_booking_rejected)
    bus.subscribe("booking.cancelled", on_booking_cancelled)
    bus.subscribe("release.requested", on_release_requested)
    bus.subscribe("release.accepted", on_release_accepted)
    bus.subscribe("release.declined", on_release_declined)
