"""
Request-Release service (Phase 3)
─────────────────────────────────
Replaces the "call the other professor and negotiate" workflow.

Flow / FSM:
  requester sees a booked slot they want  →  create_request()         (status REQUESTED)
  holder gets it in their "incoming" list →  accept()  or  decline()
    • accept  → the holder's booking is CANCELLED (slot freed), status ACCEPTED_RELEASED
    • decline → status DECLINED
  requester may withdraw                   →  cancel()                 (status CANCELLED)

THE HOLDER DECIDES. Several people can want the same slot, so open requests are
queued by created_at (queue_position, 1 = asked first) and the holder sees the earliest
one at the top — but that is presentation only. `accept()` imposes NO ordering: the
holder may accept any open request. Accepting one closes the rest, because the slot no
longer exists to give away twice. Do not describe this as first-come-first-served.

Side effects are published on the event bus (release.requested / .accepted / .declined);
notification + email handlers subscribe independently (kept decoupled, like bookings).
"""

import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.events import bus
from app.modules.models import (
    SlotReleaseRequest, ReleaseStatus, Booking, BookingStatus, User, UserRole,
    Resource, Group, Event,
)


def _utcnow():
    return datetime.now(timezone.utc)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ProposedEvent(BaseModel):
    """What the requester wants — either CREATE a new event, or MOVE an existing one
    (move_event_id) into the freed slot. Captured so accept can fulfil it."""
    title: Optional[str] = "Requested event"
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    resource_id: Optional[str] = None
    group_ids: List[str] = []
    category: str = "adhoc"
    move_event_id: Optional[str] = None   # if set, MOVE this existing event instead of creating


class ReleaseCreate(BaseModel):
    booking_id: str
    message: Optional[str] = None
    proposed_event: Optional[ProposedEvent] = None


class ReleaseAccept(BaseModel):
    mode: str = "cancel"            # "cancel" (free the slot) or "shift" (move the holder's event)
    new_start: Optional[datetime] = None
    new_end: Optional[datetime] = None
    scope: Optional[str] = None     # recurring holder event: 'occurrence' | 'following' | 'series'


class ReleaseRequestOut(BaseModel):
    id: str
    booking_id: str
    status: str
    message: Optional[str] = None
    response_note: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    requester_name: Optional[str] = None
    holder_name: Optional[str] = None
    resource_name: Optional[str] = None
    event_title: Optional[str] = None
    event_id: Optional[str] = None        # the holder's event (so the UI can hide it in the move picker)
    is_recurring: bool = False            # holder's event repeats → accept needs a scope choice
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    # What the requester wants the slot FOR — so the holder decides with full context,
    # and so a declined requester can re-use the details on a different slot.
    proposed_event: Optional[dict] = None
    queue_position: Optional[int] = None  # 1 = asked first; None once resolved


# ── Service ───────────────────────────────────────────────────────────────────

class ReleaseService:
    def __init__(self, db: Session):
        self.db = db

    def _occ_key(self, req: SlotReleaseRequest):
        """The occurrence a request contests, as a naive-UTC instant. A recurring
        series shares ONE template booking across all its dates, so requests must be
        distinguished by the occurrence they actually target (from the proposed
        event) — otherwise unrelated dates collapse into one queue / decline each
        other. One-off bookings fall back to the booking's own start."""
        dt = None
        if req.requested_event_json:
            try:
                s = json.loads(req.requested_event_json).get('start_time')
                if s:
                    dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
            except Exception:
                dt = None
        if dt is None and req.booking is not None:
            dt = req.booking.start_time
        if dt is None:
            return None
        if dt.tzinfo is not None:
            off = dt.utcoffset()
            if off:
                dt = dt - off
            return dt.replace(tzinfo=None)
        return dt

    def _queue_position(self, req: SlotReleaseRequest) -> Optional[int]:
        """Where this request sits in the line for THIS occurrence — 1 means asked
        first. Only meaningful while it's open; once resolved the queue is moot."""
        if req.status != ReleaseStatus.REQUESTED:
            return None
        my_key = self._occ_key(req)
        peers = self.db.query(SlotReleaseRequest).filter(
            SlotReleaseRequest.booking_id == req.booking_id,
            SlotReleaseRequest.status == ReleaseStatus.REQUESTED,
            SlotReleaseRequest.created_at < req.created_at,
        ).all()
        ahead = sum(1 for p in peers if self._occ_key(p) == my_key)
        return ahead + 1

    @staticmethod
    def _queued(reqs: List[SlotReleaseRequest]) -> List[SlotReleaseRequest]:
        """Open requests first, OLDEST at the top — the slot goes to whoever asked
        first, so that person must be the one the holder sees first. Resolved
        requests follow as history, newest first."""
        open_ = sorted((r for r in reqs if r.status == ReleaseStatus.REQUESTED),
                       key=lambda r: r.created_at)
        done = sorted((r for r in reqs if r.status != ReleaseStatus.REQUESTED),
                      key=lambda r: r.created_at, reverse=True)
        return open_ + done

    def _to_out(self, req: SlotReleaseRequest) -> ReleaseRequestOut:
        b = req.booking
        # The CONTESTED slot to display. For a recurring event the booking's own
        # start_time is the series anchor (its FIRST occurrence), not the date the
        # requester actually asked for — that lives in the proposed event. Show the
        # asked-for date so requester and holder both see the real slot (e.g. Aug 10,
        # not the July 24 the series happens to start on).
        pe = json.loads(req.requested_event_json) if req.requested_event_json else None
        slot_start = b.start_time if b else None
        slot_end = b.end_time if b else None
        if pe and pe.get("start_time"):
            try:
                slot_start = datetime.fromisoformat(pe["start_time"].replace("Z", "+00:00"))
                if pe.get("end_time"):
                    slot_end = datetime.fromisoformat(pe["end_time"].replace("Z", "+00:00"))
            except Exception:
                pass
        return ReleaseRequestOut(
            id=req.id,
            booking_id=req.booking_id,
            status=req.status.value,
            message=req.message,
            response_note=req.response_note,
            created_at=req.created_at,
            resolved_at=req.resolved_at,
            requester_name=req.requester.full_name if req.requester else None,
            holder_name=req.holder.full_name if req.holder else None,
            resource_name=b.resource.name if b and b.resource else None,
            event_title=b.event.title if b and b.event else None,
            event_id=b.event_id if b else None,
            is_recurring=bool(b.event.is_recurring_root) if b and b.event else False,
            start_time=slot_start,
            end_time=slot_end,
            proposed_event=(json.loads(req.requested_event_json)
                            if req.requested_event_json else None),
            queue_position=self._queue_position(req),
        )

    def create_request(self, data: ReleaseCreate, requester: User) -> ReleaseRequestOut:
        booking = self.db.query(Booking).filter(Booking.id == data.booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking.requester_id == requester.id:
            raise HTTPException(status_code=400, detail="You already hold this slot")

        # Reject a slot in the past (the UI gates this; guard the API too).
        if data.proposed_event:
            pe = data.proposed_event
            ps, pend = pe.start_time, pe.end_time
            if ps.tzinfo is None:
                ps = ps.replace(tzinfo=timezone.utc)
            if pend and pend.tzinfo is None:
                pend = pend.replace(tzinfo=timezone.utc)
            if pend and pend <= ps:
                raise HTTPException(status_code=400, detail="end_time must be after start_time")
            if ps < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="Cannot request a slot in the past")

        # one open request per (booking, requester, OCCURRENCE) — don't spam the
        # holder, but DO allow requesting different dates of the same recurring series
        want = None
        if data.proposed_event and data.proposed_event.start_time:
            w = data.proposed_event.start_time
            if w.tzinfo is not None:
                off = w.utcoffset()
                w = (w - off) if off else w
                w = w.replace(tzinfo=None)
            want = w
        for existing in self.db.query(SlotReleaseRequest).filter(
            SlotReleaseRequest.booking_id == data.booking_id,
            SlotReleaseRequest.requester_id == requester.id,
            SlotReleaseRequest.status == ReleaseStatus.REQUESTED,
        ).all():
            if want is None or self._occ_key(existing) == want:
                return self._to_out(existing)

        req = SlotReleaseRequest(
            booking_id=data.booking_id,
            requester_id=requester.id,
            holder_id=booking.requester_id,
            message=data.message,
            status=ReleaseStatus.REQUESTED,
            requested_event_json=(json.dumps(data.proposed_event.model_dump(mode="json"))
                                  if data.proposed_event else None),
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)
        bus.publish("release.requested", {
            "request_id": req.id, "holder_id": req.holder_id, "actor_id": requester.id,
        })
        return self._to_out(req)

    def list_incoming(self, user: User) -> List[ReleaseRequestOut]:
        reqs = (self.db.query(SlotReleaseRequest)
                .filter(SlotReleaseRequest.holder_id == user.id).all())
        return [self._to_out(r) for r in self._queued(reqs)]

    def list_outgoing(self, user: User) -> List[ReleaseRequestOut]:
        reqs = (self.db.query(SlotReleaseRequest)
                .filter(SlotReleaseRequest.requester_id == user.id).all())
        return [self._to_out(r) for r in self._queued(reqs)]

    def _open_request_for_holder(self, request_id: str, user: User) -> SlotReleaseRequest:
        req = self.db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == request_id).first()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.holder_id != user.id and user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Only the slot holder can respond")
        if req.status != ReleaseStatus.REQUESTED:
            raise HTTPException(status_code=400, detail="This request has already been resolved")
        return req

    def _preflight_requester_event(self, req) -> Optional[str]:
        """Can the requester's side actually be completed? Returns why not, or None.

        This MUST run before the holder's event is touched. `cancel_event` and
        `update_event` commit on their own, so by the time _auto_create_requester_event
        discovers a problem the holder's class is already gone — and the request is
        left REQUESTED, so retrying just destroys more. Every failure below was
        reachable that way: a room deactivated while the request sat pending, a cohort
        deleted (an FK violation, which isn't an HTTPException, so it escaped as a 500),
        a slot that has since fallen into the past, or a requester event that repeats
        and so can't be moved without a scope. Refusing up front keeps the holder's
        class intact and tells them exactly what to fix.
        """
        if not req.requested_event_json:
            return None
        try:
            spec = json.loads(req.requested_event_json)
        except Exception:
            return "the saved request is unreadable"

        def _dt(v):
            return datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else v

        try:
            start, end = _dt(spec.get("start_time")), _dt(spec.get("end_time"))
        except Exception:
            return "the requested time is unreadable"
        if not start or not end:
            return "the request has no time on it"

        if spec.get("move_event_id"):
            ev = self.db.query(Event).filter(Event.id == spec["move_event_id"]).first()
            if not ev:
                return "the event they wanted to move no longer exists"
            if getattr(ev, "is_recurring_root", False):
                return "their event repeats — they must move it themselves"
            return None

        # A fresh event is created for them, so it must pass the same gates as a
        # normal create — checked here rather than after the slot is already gone.
        now = datetime.now(timezone.utc)
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start < now:
            return "the requested slot is now in the past"

        res_id = spec.get("resource_id")
        if res_id:
            res = self.db.query(Resource).filter(Resource.id == res_id).first()
            if not res:
                return "the room they asked for no longer exists"
            if not res.is_active:
                return f"the room they asked for ({res.name}) has been deactivated"

        for gid in (spec.get("group_ids") or []):
            if not self.db.query(Group).filter(Group.id == gid).first():
                return "a cohort attached to their request has been deleted"

        return None

    def _auto_create_requester_event(self, req) -> None:
        """After the slot is freed, create the requester's intended event (if one was captured)."""
        if not req.requested_event_json:
            return
        from app.modules.bookings.service import BookingService, EventCreate, BookingCreate, EventUpdate
        from app.modules.availability.service import AvailabilityService
        spec = json.loads(req.requested_event_json)

        def _dt(v):
            return datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else v

        try:
            if spec.get("move_event_id"):
                # the requester wants to MOVE their existing event into the freed slot
                BookingService(self.db).update_event(
                    spec["move_event_id"],
                    EventUpdate(start_time=spec["start_time"], end_time=spec["end_time"]),
                    req.requester,
                )
                req.created_event_id = spec["move_event_id"]
                return
            # PRE-FLIGHT the room BEFORE creating anything: create_event_with_bookings
            # flushes the Event, then raises on a room clash — and since accept()
            # commits afterwards, that half-built Event used to persist as a room-less
            # ghost on everyone's calendar (e.g. when the holder moves their class ONTO
            # the freed slot). Checking first means no Event is ever created on a clash.
            res_id = spec.get("resource_id")
            if res_id:
                clash = AvailabilityService(self.db).find_conflict(
                    res_id, _dt(spec["start_time"]), _dt(spec["end_time"]))
                if clash:
                    req.response_note = f"Slot freed, but your event couldn't be auto-created: {clash.message}"
                    return
            ev = EventCreate(
                title=spec.get("title") or "Requested event",
                description=spec.get("description"),
                start_time=spec["start_time"],
                end_time=spec["end_time"],
                is_public=True,
                bookings=([BookingCreate(resource_id=spec["resource_id"],
                                         start_time=spec["start_time"],
                                         end_time=spec["end_time"])]
                          if spec.get("resource_id") else []),
                group_ids=spec.get("group_ids") or [],
                category=spec.get("category") or "adhoc",
            )
            created = BookingService(self.db).create_event_with_bookings(ev, req.requester)
            req.created_event_id = created.id
        except HTTPException as e:
            # non-room failure (e.g. student clash) — those raise BEFORE any Event is
            # added, so nothing to clean up; just tell the requester to re-book.
            verb = "moved" if spec.get("move_event_id") else "auto-created"
            req.response_note = f"Slot freed, but your event couldn't be {verb}: {e.detail}"
        except Exception as e:
            # Anything NOT an HTTPException (an FK violation from a row deleted between
            # the preflight and here, a DB error) used to escape as a 500 — after the
            # holder's event was already committed as cancelled, leaving the request
            # stuck REQUESTED and un-acceptable forever. Swallow it, roll the session
            # back to a clean state so no half-built Event survives the commit below,
            # and record why. The preflight makes this rare; this makes it harmless.
            # accept() sets req.status BEFORE calling us, and a rollback would discard
            # that too — leaving the request REQUESTED after the slot was really freed.
            # Read it while it's still in memory, then re-apply on the reloaded row.
            saved_status = req.status
            self.db.rollback()
            req.status = saved_status
            verb = "moved" if spec.get("move_event_id") else "auto-created"
            req.response_note = (f"Slot freed, but your event couldn't be {verb}: "
                                 f"{type(e).__name__}. Please create it manually.")

    def _close_rival_requests(self, req: SlotReleaseRequest) -> List[tuple]:
        """The slot has just been granted, so every other open request for it is
        closed now — leaving them REQUESTED would let the holder "accept" a slot
        they no longer own. Returns (request_id, requester_id) to notify post-commit.
        """
        # Only close rivals contesting the SAME occurrence. A recurring series shares
        # one template booking, so requests for OTHER dates must NOT be declined.
        my_key = self._occ_key(req)
        rivals = [
            r for r in self.db.query(SlotReleaseRequest).filter(
                SlotReleaseRequest.booking_id == req.booking_id,
                SlotReleaseRequest.id != req.id,
                SlotReleaseRequest.status == ReleaseStatus.REQUESTED,
            ).all()
            if self._occ_key(r) == my_key
        ]
        # No response_note. It used to read "<winner> asked for this slot first",
        # which was simply false whenever the holder accepted a later request — the
        # person who genuinely asked first was told they had been beaten to it. The
        # status (Declined) plus the push notification is the whole message.
        for rival in rivals:
            rival.status = ReleaseStatus.DECLINED
            rival.resolved_at = _utcnow()
        return [(r.id, r.requester_id) for r in rivals]

    def _contested_occurrence(self, req, holder_event):
        """Which occurrence of a recurring holder event this request contests, so
        accept touches only that date. The requester's proposed slot is the slot
        they want, so it's the one to free; fall back to the booking's own start.
        Returns None for a one-off event (no occurrence needed)."""
        if not getattr(holder_event, 'is_recurring_root', False):
            return None
        if req.requested_event_json:
            try:
                s = json.loads(req.requested_event_json).get('start_time')
                if s:
                    return datetime.fromisoformat(s.replace('Z', '+00:00'))
            except Exception:
                pass
        return req.booking.start_time if req.booking else None

    def accept(self, request_id, user, mode="cancel", new_start=None, new_end=None, scope=None) -> ReleaseRequestOut:
        """
        Accept a release request: the holder CANCELS or SHIFTS their event to free the slot,
        then the requester's intended event is auto-created in that slot.
        """
        from app.modules.bookings.service import BookingService, EventUpdate
        req = self._open_request_for_holder(request_id, user)
        holder_event = req.booking.event if req.booking else None
        bs = BookingService(self.db)

        # Validate the requester's half BEFORE giving up the slot — see
        # _preflight_requester_event. Nothing has been mutated at this point, so a
        # 400 here leaves the holder's event exactly as it was.
        blocker = self._preflight_requester_event(req)
        if blocker:
            raise HTTPException(
                status_code=400,
                detail=(f"Can't complete this swap: {blocker}. "
                        "Your event has NOT been changed."),
            )

        # If the holder's event repeats, the holder CHOSE a scope (this occurrence /
        # this and following / whole series) in the accept sheet — pass it through.
        # `occ` is the contested occurrence (the split/anchor date for the first two
        # scopes); for a one-off event both stay None and the plain path runs.
        occ = self._contested_occurrence(req, holder_event)
        eff_scope = scope
        if occ and not eff_scope:
            eff_scope = 'occurrence'   # safety net if the client somehow sent none
        # 'series' edits/cancels the whole thing — no anchor date needed
        anchor = None if eff_scope == 'series' else occ

        if mode == "shift":
            if not (new_start and new_end):
                raise HTTPException(status_code=400, detail="Shifting requires a new start and end time")
            if not holder_event:
                raise HTTPException(status_code=400, detail="No event to shift")
            # moves the holder's event; raises 409 if the new time isn't free (all clash checks apply)
            try:
                bs.update_event(holder_event.id, EventUpdate(start_time=new_start, end_time=new_end), user,
                                occurrence_date=anchor, scope=eff_scope)
                req.status = ReleaseStatus.ACCEPTED_MOVED
            except HTTPException as e:
                # Holder already freed the slot (cancelled their own event directly),
                # so there's nothing to move — mirror the cancel branch and just give
                # the requester the freed slot rather than erroring the request open.
                if 'cannot edit a cancelled' not in str(e.detail).lower():
                    raise
                req.status = ReleaseStatus.ACCEPTED_RELEASED
        else:
            if holder_event:
                try:
                    bs.cancel_event(holder_event.id, actor=user, occurrence_date=anchor, scope=eff_scope)
                except HTTPException as e:
                    # The slot is already free (e.g. the holder cancelled their event
                    # directly first). That's still a valid accept — fall through and
                    # give the requester the slot, rather than leaving the request
                    # permanently un-acceptable.
                    if 'already cancelled' not in str(e.detail).lower():
                        raise
            req.status = ReleaseStatus.ACCEPTED_RELEASED

        self._auto_create_requester_event(req)
        superseded = self._close_rival_requests(req)

        req.resolved_at = _utcnow()
        self.db.commit()
        self.db.refresh(req)
        bus.publish("release.accepted", {
            "request_id": req.id, "requester_id": req.requester_id, "actor_id": user.id,
        })
        for rival_id, requester_id in superseded:
            bus.publish("release.declined", {
                "request_id": rival_id, "requester_id": requester_id, "actor_id": user.id,
            })
        return self._to_out(req)

    def decline(self, request_id: str, user: User) -> ReleaseRequestOut:
        req = self._open_request_for_holder(request_id, user)
        req.status = ReleaseStatus.DECLINED
        req.resolved_at = _utcnow()
        self.db.commit()
        self.db.refresh(req)
        bus.publish("release.declined", {
            "request_id": req.id, "requester_id": req.requester_id, "actor_id": user.id,
        })
        return self._to_out(req)

    def cancel(self, request_id: str, user: User) -> ReleaseRequestOut:
        req = self.db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == request_id).first()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.requester_id != user.id:
            raise HTTPException(status_code=403, detail="Only the requester can cancel")
        if req.status != ReleaseStatus.REQUESTED:
            raise HTTPException(status_code=400, detail="This request has already been resolved")
        req.status = ReleaseStatus.CANCELLED
        req.resolved_at = _utcnow()
        self.db.commit()
        self.db.refresh(req)
        return self._to_out(req)
