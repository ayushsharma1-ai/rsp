"""
Recurrence Engine
─────────────────
Pure utility module. No database access. No FastAPI.
Takes recurrence rule data → returns occurrence time windows.

Why dateutil instead of storing expanded rows?
  A semester lecture "Every Mon/Wed, 9-10am, Jan–May" = 32 occurrences.
  With 50 courses that's 1600 rows. With 10 years of history: 16,000 rows.
  Storing the rule once and expanding at runtime keeps the database clean
  and makes "cancel the whole series" a single row deletion.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Tuple, Optional
from dateutil.rrule import rrulestr


def expand_rrule(
    rrule_string: str,
    dtstart: datetime,
    duration: timedelta,
    search_start: datetime,
    search_end: datetime,
) -> List[Tuple[datetime, datetime]]:

    # Normalize everything to UTC naive datetimes
    # dateutil works most reliably with naive datetimes
    # We strip timezone info and work in UTC throughout

    def to_utc_naive(dt):
        if dt.tzinfo is not None:
            # convert to UTC then strip timezone
            utc_offset = dt.utcoffset()
            if utc_offset:
                dt = dt - utc_offset
            return dt.replace(tzinfo=None)
        return dt

    dtstart_naive      = to_utc_naive(dtstart)
    search_start_naive = to_utc_naive(search_start)
    search_end_naive   = to_utc_naive(search_end)

    # Parse the RRULE with naive dtstart
    rule = rrulestr(rrule_string, dtstart=dtstart_naive, ignoretz=True)

    occurrences = []

    for occ_start in rule.between(
        search_start_naive - duration,
        search_end_naive,
        inc=True,
    ):
        occ_end = occ_start + duration

        # Standard overlap: A < D and B > C
        if occ_start < search_end_naive and occ_end > search_start_naive:
            # Re-attach UTC timezone before returning
            occurrences.append((
                occ_start.replace(tzinfo=timezone.utc),
                occ_end.replace(tzinfo=timezone.utc),
            ))

    return occurrences


def check_recurring_conflict(
    rrule_string: str,
    dtstart: datetime,
    duration: timedelta,
    requested_start: datetime,
    requested_end: datetime,
) -> Optional[Tuple[datetime, datetime]]:
    """
    Check if a requested time window conflicts with any occurrence
    of a recurring rule.

    Returns the first conflicting (occurrence_start, occurrence_end)
    if a conflict exists, or None if no conflict.

    This is what the booking service calls when checking a new booking
    against an existing recurring template.
    """
    occurrences = expand_rrule(
        rrule_string=rrule_string,
        dtstart=dtstart,
        duration=duration,
        search_start=requested_start,
        search_end=requested_end,
    )
    # Any occurrence returned means overlap — return the first one
    return occurrences[0] if occurrences else None


def get_occurrences_in_range(
    rrule_string: str,
    dtstart: datetime,
    duration: timedelta,
    range_start: datetime,
    range_end: datetime,
) -> List[dict]:
    """
    Returns occurrences formatted as calendar-ready dicts.
    Used by the calendar endpoint to display recurring events.

    Each dict has:
        start: ISO string
        end:   ISO string
    """
    pairs = expand_rrule(rrule_string, dtstart, duration, range_start, range_end)
    return [
        {"start": s.isoformat(), "end": e.isoformat()}
        for s, e in pairs
    ]