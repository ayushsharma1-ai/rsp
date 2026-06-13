# RSP — Deep Dive on the New Changes (Phases 0–5)

A complete reference for everything added in the June 2026 upgrade: the full schema,
the new backend modules/endpoints, and how data moves through each new feature.

---

## 1. The full database schema

13 tables. **NEW** marks tables added in this upgrade; the rest gained at most one column.

```
                         ┌──────────┐
                         │  users   │
                         └────┬─────┘
        organizer / requester / holder / actor (many FKs)
   ┌──────────────┬───────────┼─────────────┬───────────────┐
   ▼              ▼           ▼              ▼               ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐
│ events │  │ bookings │  │notifica- │  │ roster_people│  │ slot_release_requests │ NEW
│        │  │          │  │  tions   │  │     NEW      │  │                       │
└──┬──┬──┘  └────┬─────┘  └──────────┘  └──────┬───────┘  └───────────┬───────────┘
   │  │          │ resource_id                 │ group_members NEW    │ booking_id
   │  │          ▼                             ▼ (M:N)                ▼
   │  │     ┌──────────┐                ┌──────────┐            (points at a booking)
   │  │     │resources │                │  groups  │ NEW
   │  │     └──────────┘                └────┬─────┘
   │  │ event_groups NEW (M:N)               │
   │  └──────────────────────────────────────┘
   │ recurrence_rule_id
   ▼
┌──────────────────┐      (audit_logs, feedback, event_participants exist but are
│ recurrence_rules │       unchanged and omitted from this diagram for clarity)
└──────────────────┘
```

### Existing tables (unchanged unless noted)
| Table | Key columns | Notes |
|---|---|---|
| `users` | id, email (unique), full_name, hashed_password, role, is_active | role = admin/professor/staff/viewer |
| `resources` | id, name, description, **resource_type**, location, capacity, requires_approval, is_active | `resource_type` gained **`computer_room`** |
| `recurrence_rules` | id, rrule (RFC 5545), start_date, end_date | one row per recurring series |
| `events` | id, title, organizer_id→users, start_time, end_time, status, recurrence_rule_id, parent_event_id, occurrence_date, is_public, is_recurring_root, **category**, created_at | gained **`category`** (academic/adhoc) |
| `event_participants` | id, event_id, user_id, rsvp_status | RSVP M:N (not used for clash) |
| `bookings` | id, event_id→events, resource_id→resources, requester_id→users, start_time, end_time, status, notes, reviewed_by_id, is_recurring_template, recurrence_rule_id | the "claim on a room" |
| `notifications` | id, recipient_id→users, notification_type, title, message, is_read, related_booking_id, related_event_id | now also written for release events |
| `audit_logs` | id, actor_id, action, entity_type, entity_id, old/new_values | append-only |
| `feedback` | id, user_id, message, category, … | feedback widget |

### NEW tables (Phase 2 + 3)
| Table | Columns | Purpose |
|---|---|---|
| **`roster_people`** | id (PK), full_name, email (nullable, indexed), user_id→users (nullable), created_at | a lightweight "student" — not necessarily an app login |
| **`groups`** | id (PK), name, description, group_type (nullable), created_at | a named cohort/roster |
| **`group_members`** | id (PK), group_id→groups, roster_person_id→roster_people · UNIQUE(group_id, roster_person_id) | **junction** for the person ↔ group M:N |
| **`event_groups`** | id (PK), event_id→events, group_id→groups · UNIQUE(event_id, group_id) | **junction** for the event ↔ group M:N |
| **`slot_release_requests`** | id (PK), booking_id→bookings, requester_id→users, holder_id→users, message, status, response_note, created_at, resolved_at | one Request-Release negotiation |

### Enums
| Enum | Values | DB type |
|---|---|---|
| `ResourceType` | classroom, lab, **computer_room**, seminar_hall, meeting_room, equipment, other | `resourcetype` |
| `EventCategory` **NEW** | academic, adhoc | `eventcategory` |
| `ReleaseStatus` **NEW** | requested, accepted_released, accepted_moved, declined, cancelled | `releasestatus` |
| `BookingStatus` | pending, approved, confirmed, rejected, cancelled | unchanged (FSM) |
| `NotificationType` | booking_*, event_updated, event_cancelled, reminder | reused `event_updated` for release alerts |

> **DB labels gotcha:** SQLAlchemy stores enum **member names** (uppercase) in Postgres —
> e.g. the DB enum value is `COMPUTER_ROOM`, while the API/JSON uses the lowercase
> *value* `computer_room`. Python maps between them automatically.

---

## 2. New backend modules & endpoints

| Module | Service | Endpoints |
|---|---|---|
| `modules/availability` | **AvailabilityService** — `find_conflict` (shared overlap core, lock-aware), `is_free`, `busy_intervals`, `day_availability`, `free_slots` | `GET /availability/day`, `GET /availability/free-slots` |
| `modules/groups` | **GroupService** — group/roster CRUD + membership | `GET/POST /groups`, `GET/DELETE /groups/{id}`, `POST/DELETE /groups/{id}/members/{person_id}`, `GET/POST /roster` |
| `modules/clash` | **ClashService** — `find_clashes`, `clashes_for_event` | `POST /clashes/preview`, `GET /clashes/event/{id}` (host-only student detail) |
| `modules/release` | **ReleaseService** — create/accept/decline/cancel + FSM | `POST /release-requests`, `GET .../incoming`, `GET .../outgoing`, `POST .../{id}/accept|decline|cancel` |
| `modules/email` | **EmailService** — SMTP send + `.ics` builder; bus subscriber | (no routes — reacts to events) |

**Changed existing code:**
- `bookings/service.py` — `_create_booking` now calls `AvailabilityService.find_conflict(..., lock=True)` (one overlap rule for read + write). `EventCreate` gained `group_ids` + `category`; `create_event_with_bookings` writes `event_groups` rows and sets the category.
- `notifications/service.py` — added in-app handlers for `release.requested/accepted/declined`.
- `core/config.py` — added optional `SMTP_*` settings.
- `main.py` — registers the `availability`, `groups`, `clash`, `release` routers and the email handlers.

---

## 3. How data moves — feature by feature

### Flow A: Room availability (color dots + empty-room search)
```
ResourcesPage (date picker changes)
  → GET /api/v1/availability/day?date=YYYY-MM-DD        (Axios, JWT attached)
    → AvailabilityService.day_availability(dayStart, dayEnd)
        for each active resource:
          busy_intervals = one-off bookings overlapping the day
                         ∪ expanded RRULE occurrences of recurring templates
          is_free = (busy_intervals is empty)
    → returns [{id, name, is_free, busy:[…]}, …]
  → React stores it as a map {resourceId: availability}
  → green/orange dot per card; "Only free rooms" + search filter the list
```

### Flow B: Creating an event (with live clash preview)
```
CreateEventModal — as you pick time / resources / groups:
  → POST /api/v1/clashes/preview {start, end, group_ids, resource_ids}
    → ClashService.find_clashes(...)
        my_people     = group_ids → group_members → roster_people        (set)
        my_resources  = the chosen resource_ids                          (set)
        candidates    = events overlapping [start,end), not cancelled, not recurring-root
        for each candidate event:
          venue_clash   = my_resources ∩ its booked resource_ids ≠ ∅
          student_clash = my_people    ∩ (its groups → people)  ≠ ∅
          → ClashInfo{venue_clash, student_clash, shared_student_count}   (COUNT only)
  → modal shows "⚠ N possible clashes"

On Submit:
  → POST /api/v1/events {title, start, end, bookings[], group_ids[], category}
    → BookingService.create_event_with_bookings
        INSERT events (with category)
        for each booking: _create_booking → AvailabilityService.find_conflict(lock=True)
                          (SELECT … FOR UPDATE → 409 if the room is taken)
        for each group_id: INSERT event_groups
        COMMIT  →  bus.publish("event.created") and per-booking booking.confirmed/pending
```

### Flow C: Clash detection internals (the SQL story)
"Which students does event E touch?" is a chain of **JOINs / lookups**:
```
event_groups (event_id = E)  →  group_members (group_id IN …)  →  roster_people
```
A **student clash** between events A and B = `people(A) ∩ people(B) ≠ ∅` (Python set
intersection over those ids). **Privacy:** only the size of that intersection ever leaves
the service; names never do. `GET /clashes/event/{id}` additionally blanks student-clash
info unless the caller is the event's organizer or an admin.

### Flow D: Request-Release
```
"Request this slot" (on a booking you don't hold)
  → POST /release-requests {booking_id}
    → ReleaseService.create_request
        holder = booking.requester_id ; INSERT slot_release_requests(status=requested)
        bus.publish("release.requested", {request_id, holder_id})
          → NotificationService → in-app notification to the holder
          → EmailService        → email to the holder (no-op if SMTP unset)

Holder opens Requests → GET /release-requests/incoming
Holder taps Accept    → POST /release-requests/{id}/accept
    → ReleaseService.accept
        booking.status = CANCELLED      (slot is freed)
        request.status = ACCEPTED_RELEASED ; resolved_at = now
        bus.publish("release.accepted") → notify + email the requester
```
FSM: `requested → accepted_released | declined | cancelled`. Only the holder (or admin)
can accept/decline; only the requester can cancel; only an open (`requested`) request can change.

### Flow E: Notifications fan-out (the event bus)
The in-process **event bus** is publish/subscribe. One domain event → many independent
reactions, with publishers never importing subscribers:
```
                      bus.publish("booking.confirmed" / "release.accepted" / …)
                                         │
                 ┌───────────────────────┴────────────────────────┐
                 ▼                                                  ▼
   NotificationService.on_*                              EmailService.on_*
   (writes a row in `notifications`)        (sends email; attaches a .ics invite
                                             for confirmed/approved bookings)
```
**ICS invites** are hand-built RFC 5545 text (`METHOD:REQUEST`) so Google/Apple/Outlook
treat them as RSVP invitations. Push is **one-way** — we send invites out; we never read
personal calendars back.

### Flow F: Free-slot finder
```
Resources page → "Find open times" on a room
  → GET /availability/free-slots?resource_id=&date=&duration_minutes=&from_hour=&to_hour=
    → AvailabilityService.free_slots
        busy = busy_intervals(resource, window)        (one-off + recurring)
        walk the busy list, return the GAPS ≥ duration inside the working window
  → modal lists the open windows
```

---

## 4. Event bus reference (who publishes / subscribes)

| Event | Published by | In-app notify | Email |
|---|---|---|---|
| `booking.pending` | BookingService (create, needs approval) | ✓ requester | ✓ requester |
| `booking.confirmed` | BookingService (create, auto) | ✓ requester | ✓ requester + ICS |
| `booking.approved` | BookingService.review | ✓ requester | ✓ requester + ICS |
| `booking.rejected` | BookingService.review | ✓ requester | ✓ requester |
| `booking.cancelled` | BookingService.cancel/delete | ✓ requester | ✓ requester |
| `release.requested` | ReleaseService.create_request | ✓ holder | ✓ holder |
| `release.accepted` | ReleaseService.accept | ✓ requester | ✓ requester |
| `release.declined` | ReleaseService.decline | ✓ requester | ✓ requester |
| `event.created` / `event.cancelled` / `resource.created` | various | (no handler) | (no handler) |

---

## 5. One sentence to remember
Everything new is the **time-overlap rule** (`startA < endB AND endA > startB`) applied with
extra conditions — *same room?* (venue clash), *shared people?* (student clash via the M:N
junctions), *which gaps are left?* (free slots) — and every state change fans out through the
**event bus** to in-app + email channels.
