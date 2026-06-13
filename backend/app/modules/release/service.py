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
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


# ── Service ───────────────────────────────────────────────────────────────────

class ReleaseService:
    def __init__(self, db: Session):
        self.db = db

    def _to_out(self, req: SlotReleaseRequest) -> ReleaseRequestOut:
        b = req.booking
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
            start_time=b.start_time if b else None,
            end_time=b.end_time if b else None,
        )

    def create_request(self, data: ReleaseCreate, requester: User) -> ReleaseRequestOut:
        booking = self.db.query(Booking).filter(Booking.id == data.booking_id).first()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if booking.requester_id == requester.id:
            raise HTTPException(status_code=400, detail="You already hold this slot")

        # one open request per (booking, requester) — don't spam the holder
        existing = self.db.query(SlotReleaseRequest).filter(
            SlotReleaseRequest.booking_id == data.booking_id,
            SlotReleaseRequest.requester_id == requester.id,
            SlotReleaseRequest.status == ReleaseStatus.REQUESTED,
        ).first()
        if existing:
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
                .filter(SlotReleaseRequest.holder_id == user.id)
                .order_by(SlotReleaseRequest.created_at.desc()).all())
        return [self._to_out(r) for r in reqs]

    def list_outgoing(self, user: User) -> List[ReleaseRequestOut]:
        reqs = (self.db.query(SlotReleaseRequest)
                .filter(SlotReleaseRequest.requester_id == user.id)
                .order_by(SlotReleaseRequest.created_at.desc()).all())
        return [self._to_out(r) for r in reqs]

    def _open_request_for_holder(self, request_id: str, user: User) -> SlotReleaseRequest:
        req = self.db.query(SlotReleaseRequest).filter(SlotReleaseRequest.id == request_id).first()
        if not req:
            raise HTTPException(status_code=404, detail="Request not found")
        if req.holder_id != user.id and user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Only the slot holder can respond")
        if req.status != ReleaseStatus.REQUESTED:
            raise HTTPException(status_code=400, detail="This request has already been resolved")
        return req

    def _auto_create_requester_event(self, req) -> None:
        """After the slot is freed, create the requester's intended event (if one was captured)."""
        if not req.requested_event_json:
            return
        from app.modules.bookings.service import BookingService, EventCreate, BookingCreate, EventUpdate
        spec = json.loads(req.requested_event_json)
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
            # Slot is freed, but the requester's event still can't be placed (e.g. a student
            # clash with a third event). Complete the release; the requester is told to re-book.
            verb = "moved" if spec.get("move_event_id") else "auto-created"
            req.response_note = f"Slot freed, but your event couldn't be {verb}: {e.detail}"

    def accept(self, request_id, user, mode="cancel", new_start=None, new_end=None) -> ReleaseRequestOut:
        """
        Accept a release request: the holder CANCELS or SHIFTS their event to free the slot,
        then the requester's intended event is auto-created in that slot.
        """
        from app.modules.bookings.service import BookingService, EventUpdate
        req = self._open_request_for_holder(request_id, user)
        holder_event = req.booking.event if req.booking else None
        bs = BookingService(self.db)

        if mode == "shift":
            if not (new_start and new_end):
                raise HTTPException(status_code=400, detail="Shifting requires a new start and end time")
            if not holder_event:
                raise HTTPException(status_code=400, detail="No event to shift")
            # moves the holder's event; raises 409 if the new time isn't free (all clash checks apply)
            bs.update_event(holder_event.id, EventUpdate(start_time=new_start, end_time=new_end), user)
            req.status = ReleaseStatus.ACCEPTED_MOVED
        else:
            if holder_event:
                bs.cancel_event(holder_event.id, actor=user)
            req.status = ReleaseStatus.ACCEPTED_RELEASED

        self._auto_create_requester_event(req)

        req.resolved_at = _utcnow()
        self.db.commit()
        self.db.refresh(req)
        bus.publish("release.accepted", {
            "request_id": req.id, "requester_id": req.requester_id, "actor_id": user.id,
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
