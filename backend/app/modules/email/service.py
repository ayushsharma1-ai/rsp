"""
Email + ICS calendar invites (Phase 4)
──────────────────────────────────────
Meeting requirement D: on a schedule change, notify affected people in-app AND by email,
and send `.ics` calendar invites (RSVP) so they can add events to their own calendars.

Design notes:
  • Subscribes to the SAME event bus the in-app notifier uses (decoupled side effect).
  • NO new dependencies: Python's built-in `smtplib` + a hand-rolled iCalendar string.
  • No-ops gracefully if SMTP isn't configured (mirrors the existing Discord webhook),
    so the app works fine until you add real credentials to .env.
  • ONE-WAY push only: we send invites OUT; we never read personal calendars back.
"""

import smtplib
import logging
from email.message import EmailMessage
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.events import bus
from app.modules.models import Booking, SlotReleaseRequest

logger = logging.getLogger(__name__)


# ── SMTP plumbing ─────────────────────────────────────────────────────────────

def _cfg(name, default=""):
    return getattr(settings, name, default)


def _smtp_configured() -> bool:
    return bool(_cfg("SMTP_HOST") and _cfg("SMTP_FROM"))


def send_email(to_email: str, subject: str, body: str, ics_text: str = None):
    """Send one email (optionally with an .ics invite). Silent no-op if unconfigured."""
    if not to_email:
        return
    if not _smtp_configured():
        logger.info(f"[email] SMTP not configured — skipped '{subject}' to {to_email}")
        return

    msg = EmailMessage()
    msg["From"] = _cfg("SMTP_FROM")
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    if ics_text:
        msg.add_attachment(
            ics_text.encode("utf-8"),
            maintype="text", subtype="calendar",
            filename="invite.ics", params={"method": "REQUEST"},
        )

    try:
        host = _cfg("SMTP_HOST")
        port = int(_cfg("SMTP_PORT", 587) or 587)
        user = _cfg("SMTP_USER")
        pw = _cfg("SMTP_PASSWORD")
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            server.starttls()
        try:
            if user and pw:
                server.login(user, pw)
            server.send_message(msg)
        finally:
            server.quit()
        logger.info(f"[email] sent '{subject}' to {to_email}")
    except Exception as e:
        logger.error(f"[email] failed sending '{subject}' to {to_email}: {e}")


# ── ICS (iCalendar) generation ────────────────────────────────────────────────

def _ics_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_dt(d: datetime) -> str:
    if d.tzinfo is not None:
        d = d.astimezone(timezone.utc)
    return d.strftime("%Y%m%dT%H%M%SZ")


def build_ics(uid: str, summary: str, start: datetime, end: datetime,
              description: str = "", location: str = "") -> str:
    """Minimal RFC 5545 VEVENT. METHOD:REQUEST = an RSVP invite the recipient can add."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//RSP//Scheduler//EN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_ics_dt(datetime.now(timezone.utc))}",
        f"DTSTART:{_ics_dt(start)}",
        f"DTEND:{_ics_dt(end)}",
        f"SUMMARY:{_ics_escape(summary)}",
        f"DESCRIPTION:{_ics_escape(description)}",
        f"LOCATION:{_ics_escape(location)}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"


def _fmt(d: datetime) -> str:
    return d.strftime("%b %d, %Y at %H:%M UTC") if d else ""


# ── Bus handlers: booking events ──────────────────────────────────────────────

def _send_booking_email(payload, subject_fn, body_fn, attach_invite=False):
    db = SessionLocal()
    try:
        b = db.query(Booking).filter(Booking.id == payload.get("booking_id")).first()
        if not b or not b.requester or not b.requester.email:
            return
        ics = None
        if attach_invite and b.event:
            ics = build_ics(
                uid=f"booking-{b.id}@rsp",
                summary=b.event.title,
                start=b.start_time, end=b.end_time,
                description=b.notes or "",
                location=b.resource.name if b.resource else "",
            )
        send_email(b.requester.email, subject_fn(b), body_fn(b), ics_text=ics)
    finally:
        db.close()


def on_booking_pending(payload):
    _send_booking_email(payload,
        lambda b: f"Booking pending approval: {b.event.title if b.event else 'Event'}",
        lambda b: f"Your booking for {b.resource.name if b.resource else 'a resource'} "
                  f"on {_fmt(b.start_time)} is awaiting admin approval.")


def on_booking_confirmed(payload):
    _send_booking_email(payload,
        lambda b: f"Booking confirmed: {b.event.title if b.event else 'Event'}",
        lambda b: f"Your booking for {b.resource.name if b.resource else 'a resource'} "
                  f"on {_fmt(b.start_time)} is confirmed. A calendar invite is attached.",
        attach_invite=True)


def on_booking_approved(payload):
    _send_booking_email(payload,
        lambda b: f"Booking approved: {b.event.title if b.event else 'Event'}",
        lambda b: f"Your booking for {b.resource.name if b.resource else 'a resource'} "
                  f"on {_fmt(b.start_time)} was approved. A calendar invite is attached.",
        attach_invite=True)


def on_booking_rejected(payload):
    _send_booking_email(payload,
        lambda b: f"Booking rejected: {b.event.title if b.event else 'Event'}",
        lambda b: f"Sorry — your booking for {b.resource.name if b.resource else 'a resource'} "
                  f"on {_fmt(b.start_time)} was rejected.")


def on_booking_cancelled(payload):
    _send_booking_email(payload,
        lambda b: f"Booking cancelled: {b.event.title if b.event else 'Event'}",
        lambda b: f"The booking for {b.resource.name if b.resource else 'a resource'} "
                  f"on {_fmt(b.start_time)} has been cancelled.")


# ── Bus handlers: release events ──────────────────────────────────────────────

def _send_release_email(payload, recipient_attr, subject, body_fn):
    db = SessionLocal()
    try:
        req = db.query(SlotReleaseRequest).filter(
            SlotReleaseRequest.id == payload.get("request_id")).first()
        if not req:
            return
        recipient = getattr(req, recipient_attr)
        if not recipient or not recipient.email:
            return
        send_email(recipient.email, subject, body_fn(req))
    finally:
        db.close()


def on_release_requested(payload):
    _send_release_email(payload, "holder", "Someone requested your booked slot",
        lambda r: f"{r.requester.full_name if r.requester else 'A colleague'} has requested a slot "
                  f"you currently hold. Open the Requests page to accept (release) or decline.")


def on_release_accepted(payload):
    _send_release_email(payload, "requester", "Your slot request was accepted",
        lambda r: f"{r.holder.full_name if r.holder else 'The holder'} released the slot you requested. "
                  f"It is now free — you can book it.")


def on_release_declined(payload):
    _send_release_email(payload, "requester", "Your slot request was declined",
        lambda r: f"{r.holder.full_name if r.holder else 'The holder'} declined your slot request.")


# ── Registration (called once at startup) ─────────────────────────────────────

def register_email_handlers():
    bus.subscribe("booking.pending", on_booking_pending)
    bus.subscribe("booking.confirmed", on_booking_confirmed)
    bus.subscribe("booking.approved", on_booking_approved)
    bus.subscribe("booking.rejected", on_booking_rejected)
    bus.subscribe("booking.cancelled", on_booking_cancelled)
    bus.subscribe("release.requested", on_release_requested)
    bus.subscribe("release.accepted", on_release_accepted)
    bus.subscribe("release.declined", on_release_declined)
