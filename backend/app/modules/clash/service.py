"""
Clash detection (Phase 2) — the heart of the meeting's request.

THE RULE (from the meeting):
  Two events CLASH only when their time slots OVERLAP **and**
     (they share a venue/resource)  OR  (their students intersect).
  • Different time  → never a clash (a person can attend both).
  • Same time, different venue, no shared students → NOT a clash.

HOW STUDENT OVERLAP IS COMPUTED:
  event ──(event_groups)── groups ──(group_members)── roster_people
  We expand each event's groups down to the set of people, then ask:
  does event A's people-set INTERSECT event B's people-set?

PRIVACY (meeting rule E):
  We compute the actual intersection of *people*, but only ever return a
  COUNT (`shared_student_count`) — never the names. The route layer further
  hides student-clash info from anyone who isn't the event's host.
"""

from datetime import datetime
from typing import List, Optional, Set

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.modules.models import (
    Event, EventStatus, EventGroup, GroupMember, Booking, BookingStatus,
)
from app.core.recurrence import expand_rrule

# A booking in any of these states is a live claim on a room.
ACTIVE_BOOKING_STATUSES = [
    BookingStatus.CONFIRMED,
    BookingStatus.APPROVED,
    BookingStatus.PENDING,
]


def _to_utc_naive(dt):
    """Normalise to naive-UTC so datetimes compare by absolute INSTANT, never by the
    string offset they carry (RRULE occurrences come back +00:00, DB exception rows in
    server-local +05:30 — same moment, different text)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        off = dt.utcoffset()
        if off:
            dt = dt - off
        return dt.replace(tzinfo=None)
    return dt


class VenueBooking(BaseModel):
    """Who currently holds a contested room (meeting C: 'see who holds a booked slot')."""
    booking_id: str
    resource_id: str
    resource_name: Optional[str] = None
    holder_id: str
    holder_name: Optional[str] = None


class ClashInfo(BaseModel):
    event_id: str
    title: str
    start: datetime
    end: datetime
    venue_clash: bool                 # shares a booked resource with us
    shared_resource_ids: List[str]
    venue_bookings: List[VenueBooking] = []   # for venue clashes: who to send a release request to
    student_clash: bool               # shares at least one student with us
    shared_student_count: int         # COUNT only — names are never exposed (privacy)


class ClashService:
    def __init__(self, db: Session):
        self.db = db

    # -- helpers --------------------------------------------------------------
    def _people_for_groups(self, group_ids) -> Set[str]:
        """Expand a set of group ids → the set of roster_person ids in them."""
        group_ids = list(group_ids or [])
        if not group_ids:
            return set()
        rows = (
            self.db.query(GroupMember.roster_person_id)
            .filter(GroupMember.group_id.in_(group_ids))
            .distinct()
            .all()
        )
        return {r[0] for r in rows}

    def _group_ids_for_event(self, event_id: str) -> List[str]:
        return [r[0] for r in self.db.query(EventGroup.group_id)
                .filter(EventGroup.event_id == event_id).all()]

    def _resource_ids_for_event(self, event_id: str) -> Set[str]:
        rows = (
            self.db.query(Booking.resource_id)
            .filter(Booking.event_id == event_id,
                    Booking.status.in_(ACTIVE_BOOKING_STATUSES))
            .all()
        )
        return {r[0] for r in rows}

    def _effective_occurrences_for_root(self, root, search_start, search_end):
        """Exception-aware occurrences of a recurring ROOT event in [start, end).

        Mirrors AvailabilityService._effective_occurrences so clash detection agrees
        with the calendar. A recurring root stores one RRULE; any occurrence can be
        overridden by an exception Event (parent_event_id = root, keyed by
        occurrence_date):
          • CANCELLED exception  → that date is VACATED (the slot is free).
          • CONFIRMED exception  → the occurrence happens at the exception's OWN time
                                    (which may have MOVED to a different hour/day).
        Without this, a class that was moved (or cancelled) still reported its ORIGINAL
        RRULE slot as busy — so "request this slot" showed a phantom holder on a slot
        that is actually free (and the calendar, which IS exception-aware, disagreed)."""
        duration = root.end_time - root.start_time
        occ = expand_rrule(
            root.recurrence_rule.rrule, root.start_time, duration, search_start, search_end,
        )
        exceptions = self.db.query(Event).filter(Event.parent_event_id == root.id).all()
        if not exceptions:
            return occ
        overridden = {_to_utc_naive(ex.occurrence_date) for ex in exceptions if ex.occurrence_date is not None}

        # Mirror AvailabilityService._effective_occurrences: an occurrence moved to a
        # DIFFERENT room no longer occupies this series' room, so it must not be
        # reported as a clash there (it is reported against its own room instead,
        # because the exception carries its own Booking and Pass 1 picks that up).
        # An occurrence that owns a booking is reported against ITS OWN room by Pass 1
        # (exception rows are plain non-root events), so this series must not report
        # it too — that would both double-report and wrongly blame the series' room.
        owns_booking = set()
        ex_ids = [ex.id for ex in exceptions]
        if ex_ids:
            for bk in self.db.query(Booking).filter(
                Booking.event_id.in_(ex_ids),
                Booking.is_recurring_template == False,  # noqa: E712
            ).all():
                owns_booking.add(bk.event_id)

        # moved/edited occurrences count at their NEW time (if it overlaps the window)
        result = [
            (ex.start_time, ex.end_time)
            for ex in exceptions
            if ex.status != EventStatus.CANCELLED and ex.occurrence_date is not None
            and ex.id not in owns_booking
            and _to_utc_naive(ex.start_time) < _to_utc_naive(search_end)
            and _to_utc_naive(ex.end_time) > _to_utc_naive(search_start)
        ]
        # keep RRULE occurrences no exception has overridden (cancelled ones just drop out)
        result.extend((s, e) for (s, e) in occ if _to_utc_naive(s) not in overridden)
        return result

    # -- the core -------------------------------------------------------------
    def _make_clash(self, ev, shared_res, shared_ppl, when_start, when_end) -> ClashInfo:
        """Build a ClashInfo for a clashing event, incl. who holds the shared room(s)."""
        venue_bookings = []
        if shared_res:
            bks = self.db.query(Booking).filter(
                Booking.event_id == ev.id,
                Booking.resource_id.in_(list(shared_res)),
                Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            ).all()
            for bk in bks:
                venue_bookings.append(VenueBooking(
                    booking_id=bk.id,
                    resource_id=bk.resource_id,
                    resource_name=bk.resource.name if bk.resource else None,
                    holder_id=bk.requester_id,
                    holder_name=bk.requester.full_name if bk.requester else None,
                ))
        return ClashInfo(
            event_id=ev.id,
            title=ev.title,
            start=when_start,
            end=when_end,
            venue_clash=bool(shared_res),
            shared_resource_ids=list(shared_res),
            venue_bookings=venue_bookings,
            student_clash=bool(shared_ppl),
            shared_student_count=len(shared_ppl),
        )

    def find_clashes(
        self,
        start: datetime,
        end: datetime,
        group_ids,
        resource_ids,
        exclude_event_id: Optional[str] = None,
    ) -> List[ClashInfo]:
        """
        Find all events that clash with `[start, end)` for the given groups + resources.
        Covers BOTH one-off events and recurring series (each recurring root is expanded
        to see whether any of its weekly occurrences lands in the window).
        """
        my_people = self._people_for_groups(group_ids)
        my_resources = set(resource_ids or [])
        clashes: List[ClashInfo] = []

        # ── Pass 1: concrete (non-recurring) events overlapping the window ──
        q = self.db.query(Event).filter(
            Event.status != EventStatus.CANCELLED,
            Event.start_time < end,          # ┐ the overlap rule
            Event.end_time > start,          # ┘
            Event.is_recurring_root == False,
        )
        if exclude_event_id:
            q = q.filter(Event.id != exclude_event_id)
        for ev in q.all():
            shared_res = my_resources & self._resource_ids_for_event(ev.id)
            shared_ppl = my_people & self._people_for_groups(self._group_ids_for_event(ev.id))
            if shared_res or shared_ppl:     # the meeting's OR condition
                clashes.append(self._make_clash(ev, shared_res, shared_ppl, ev.start_time, ev.end_time))

        # ── Pass 2: recurring series — expand each root, check overlapping occurrences ──
        rec_q = self.db.query(Event).filter(
            Event.status != EventStatus.CANCELLED,
            Event.is_recurring_root == True,
        )
        if exclude_event_id:
            rec_q = rec_q.filter(Event.id != exclude_event_id)
        for ev in rec_q.all():
            if not ev.recurrence_rule:
                continue
            # Exception-aware: a cancelled occurrence frees its slot, a moved one counts
            # at its NEW time. Then keep only those that actually overlap the window.
            occ = [
                (s, e) for (s, e) in self._effective_occurrences_for_root(ev, start, end)
                if _to_utc_naive(s) < _to_utc_naive(end) and _to_utc_naive(e) > _to_utc_naive(start)
            ]
            if not occ:
                continue   # no (effective) occurrence of this series lands in the window
            shared_res = my_resources & self._resource_ids_for_event(ev.id)
            shared_ppl = my_people & self._people_for_groups(self._group_ids_for_event(ev.id))
            if shared_res or shared_ppl:
                occ.sort(key=lambda iv: _to_utc_naive(iv[0]))
                occ_s, occ_e = occ[0]
                clashes.append(self._make_clash(ev, shared_res, shared_ppl, occ_s, occ_e))

        return clashes

    def clashes_for_event(self, event_id: str, start=None, end=None) -> List[ClashInfo]:
        ev = self.db.query(Event).filter(Event.id == event_id).first()
        if not ev:
            raise HTTPException(status_code=404, detail="Event not found")
        # start/end let callers preview clashes at a PROPOSED new time (edit); else use current.
        return self.find_clashes(
            start or ev.start_time, end or ev.end_time,
            self._group_ids_for_event(event_id),
            self._resource_ids_for_event(event_id),
            exclude_event_id=event_id,
        )
