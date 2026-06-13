# RSP Backend — API Reference (for building a new UI)

Full picture of the backend so a new frontend can be built against it without guessing.
The **authoritative, machine-readable** version is [`openapi.json`](./openapi.json) (FastAPI's
auto-generated OpenAPI 3 spec) — feed that to design/codegen tools. This file is the readable summary.

---

## Conventions (read first)

- **Base URL:** every endpoint is under `/api/v1` (except `GET /health`).
- **Dev setup:** frontend (Vite, :5173) proxies `/api/*` → backend (`:8000`). So the frontend calls
  relative paths like `/api/v1/events`. (`vite.config.js` does the proxy.)
- **Auth:** JWT Bearer. Get a token from `POST /auth/login`, then send
  `Authorization: Bearer <token>` on every other request. Only `login`, `register`, `health` are public.
- **Format:** JSON in/out. **Datetimes are ISO-8601 UTC** (e.g. `2026-06-10T10:00:00Z`). **IDs are
  UUID strings.** Enum values in JSON are the **lowercase** values listed below.
- **Errors:** non-2xx returns `{ "detail": "message" }`. Common: `400` validation, `401` bad/missing
  token, `403` wrong role, `404` not found, `409` conflict (room taken / student clash / FSM).
- **Roles:** `admin`, `professor`, `staff`, `viewer`. "Admin-only" endpoints are marked 🔒.

---

## 1. Auth
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` | `{ access_token, ...user }` (token + the user) |
| POST | `/auth/register` | public | `{ email, full_name, password }` | the created user |
| GET | `/auth/me` | user | — | the current user |

**User object:** `{ id, email, full_name, role, is_active, created_at }`.

## 2. Users & Notifications
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/users` | 🔒 admin | — | `User[]` |
| GET | `/users/{user_id}` | 🔒 admin | — | `User` |
| PATCH | `/users/{user_id}` | 🔒 admin | `{ full_name?, role?, is_active? }` | `User` |
| GET | `/users/me/notifications?unread_only=false` | user | — | `Notification[]` |
| POST | `/users/me/notifications/read` | user | — | `204` (mark all read) |

**Notification:** `{ id, recipient_id, notification_type, title, message, is_read, related_booking_id?, related_event_id?, created_at }`.

## 3. Resources (rooms/labs/equipment)
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/resources?resource_type=&active_only=true` | user | — | `Resource[]` |
| GET | `/resources/{id}` | user | — | `Resource` |
| POST | `/resources` | 🔒 admin | `ResourceCreate` | `Resource` |
| PATCH | `/resources/{id}` | 🔒 admin | partial `Resource` | `Resource` |
| DELETE | `/resources/{id}` | 🔒 admin | — | `204` (soft-delete → `is_active=false`) |

**Resource:** `{ id, name, description?, resource_type, location?, capacity?, requires_approval, is_active, created_at }`.
**`resource_type` enum:** `classroom, lab, computer_room, seminar_hall, meeting_room, equipment, other`.

## 4. Availability (read-only; powers colours, search, free-slots)
| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `/availability/day?date=YYYY-MM-DD&resource_type=` | user | `ResourceAvailability[]` |
| GET | `/availability/free-slots?resource_id=&date=&duration_minutes=60&from_hour=8&to_hour=20` | user | `{ resource_id, free_slots: Interval[] }` |

**ResourceAvailability:** `{ id, name, resource_type, location?, capacity?, requires_approval, is_free, busy: Interval[] }`.
**Interval:** `{ start, end }` (ISO datetimes).

## 5. Events
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/events` | user | — | `Event[]` |
| POST | `/events` | user | `EventCreate` | `Event` (one-off event + its bookings) |
| POST | `/events/recurring` | user | `RecurringEventCreate` | `{ event_id, rule_id, ... }` |
| GET | `/events/calendar?start=&end=` | user | — | `CalendarBlock[]` (RRULEs expanded) |
| GET | `/events/{id}` | user | — | event detail w/ bookings |
| PATCH | `/events/{id}` | organizer/admin | `{ start_time?, end_time?, title?, description?, occurrence_date? }` | updated |
| POST | `/events/{id}/cancel` | organizer/admin | `{ occurrence_date? }` | cancels event (or one occurrence) |
| POST | `/events/{id}/cancel-occurrence` | organizer/admin | `{ occurrence_date }` | cancel one occurrence |
| POST | `/events/{id}/edit-occurrence` | organizer/admin | `{ occurrence_date, new_start, new_end, new_title?, new_description? }` | edit one occurrence |
| DELETE | `/events/{id}/series` | organizer/admin | — | delete whole recurring series |

**EventCreate:** `{ title, description?, start_time, end_time, is_public, bookings: BookingCreate[], group_ids: string[], category }`.
**BookingCreate:** `{ resource_id, start_time, end_time, notes? }`.
**`category` enum:** `academic`, `adhoc`. **Event:** `{ id, title, description?, organizer_id, start_time, end_time, status, is_public, created_at }`.
**`status` (EventStatus):** `draft, confirmed, cancelled`.
**RecurringEventCreate:** `{ title, description?, rrule, series_start, series_end_date, duration_minutes, resource_id?, is_public, notes?, group_ids: string[] }` (rrule is RFC-5545, e.g. `FREQ=WEEKLY;BYDAY=MO,WE`).

> **Conflict behaviour:** creating/editing a booking returns `409` if the room is taken
> (venue clash) **or** if the event's groups share students with another event at that time
> (student clash — hard block).

## 6. Bookings (a claim on a resource for an event)
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/bookings?status=&resource_id=` | user (admin sees all) | — | `BookingWithDetails[]` |
| PATCH | `/bookings/{id}/review?new_status=approved\|rejected` | 🔒 admin | — | `{ id, status }` |
| PATCH | `/bookings/{id}/cancel` | owner/admin | — | `{ id, status }` |
| PATCH | `/bookings/{id}` | owner/admin | `{ start_time?, end_time?, notes? }` | updated booking |

**BookingWithDetails:** `{ id, event_id, resource_id, requester_id, start_time, end_time, status, notes?, created_at, resource_name?, event_title?, requester_name? }`.
**`status` (BookingStatus):** `pending, approved, confirmed, rejected, cancelled`.

## 7. Groups & Roster (cohorts for clash detection)
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/groups` | user | — | `{ id, name, description?, group_type?, member_count }[]` |
| POST | `/groups` | user | `{ name, description?, group_type? }` | group |
| GET | `/groups/{id}` | user | — | group + `members: RosterPerson[]` |
| DELETE | `/groups/{id}` | user | — | `204` |
| POST | `/groups/{id}/members/{person_id}` | user | — | `204` (add person to group) |
| DELETE | `/groups/{id}/members/{person_id}` | user | — | `204` |
| GET | `/roster` | user | — | `RosterPerson[]` |
| POST | `/roster` | user | `{ full_name, email? }` | `RosterPerson` |

**RosterPerson:** `{ id, full_name, email? }`.

## 8. Clash detection
| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| POST | `/clashes/preview` | user | `{ start_time, end_time, group_ids: [], resource_ids: [] }` | `ClashInfo[]` |
| GET | `/clashes/event/{id}?start=&end=` | user | (start/end optional → preview at a new time) | `ClashInfo[]` (student detail host-only) |

**ClashInfo:** `{ event_id, title, start, end, venue_clash, shared_resource_ids: [], venue_bookings: VenueBooking[], student_clash, shared_student_count }`.
**VenueBooking:** `{ booking_id, resource_id, resource_name?, holder_id, holder_name? }` (who to send a release request to).
> **Privacy:** only a count of shared students is ever returned — never names. Student-clash detail
> is hidden from non-hosts on the `event/{id}` endpoint.

## 9. Request-Release (negotiate a held slot)
| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/release-requests` | user | `ReleaseCreate` | `ReleaseRequest` |
| GET | `/release-requests/incoming` | user | — | requests where I'm the holder |
| GET | `/release-requests/outgoing` | user | — | requests I sent |
| POST | `/release-requests/{id}/accept` | holder/admin | `ReleaseAccept` | frees slot + fulfils requester intent |
| POST | `/release-requests/{id}/decline` | holder/admin | — | declines |
| POST | `/release-requests/{id}/cancel` | requester | — | withdraws |

**ReleaseCreate:** `{ booking_id, message?, proposed_event?: ProposedEvent }`.
**ProposedEvent** (what to do on accept): `{ title?, description?, start_time, end_time, resource_id?, group_ids: [], category, move_event_id? }`
— if `move_event_id` is set, accept **moves that existing event** into the freed slot; otherwise it
**creates** a new event from these details. (Omit `proposed_event` entirely → accept just frees the slot.)
**ReleaseAccept:** `{ mode: "cancel" | "shift", new_start?, new_end? }` (`shift` moves the holder's event to the new time).
**ReleaseRequest:** `{ id, booking_id, status, message?, response_note?, created_at, resolved_at?, requester_name?, holder_name?, resource_name?, event_title?, start_time?, end_time? }`.
**`status` (ReleaseStatus):** `requested, accepted_released, accepted_moved, declined, cancelled`.

## 10. Feedback
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/feedback` | user | `{ message, category, page_url?, page_name?, browser? }` |
| GET | `/feedback` | 🔒 admin | — |

---

## Demo accounts (seeded)
`admin@rsp.edu / admin123` (admin), `alice@rsp.edu / alice123` (professor),
`bob@rsp.edu / bob123` (professor), `carol@rsp.edu / carol123` (staff).

---

## How to prompt Claude (design) so integration is painless

Goal: get a UI whose data calls already match these endpoints, so wiring it up later = drop in the
base URL + token, not reshape everything.

**1. Give it the contract.** Attach **`openapi.json`** (or paste this file). Tell it:
> "This is my real backend's OpenAPI spec. Build the UI to talk to **these exact endpoints and field
> names** — do not invent endpoints or rename fields."

**2. State the hard rules** (paste verbatim):
> - All calls go to a base URL `/api/v1`.
> - Auth: `POST /auth/login {email,password}` returns a JWT; send `Authorization: Bearer <token>`
>   on every other call; store the token; redirect to login on `401`.
> - Datetimes are ISO-8601 UTC strings; IDs are strings; enums are exactly the values in the spec.
> - On `409`, show the `detail` message (it's a real conflict like "room taken" or "student clash").

**3. Ask for a thin, swappable API layer:**
> "Put **all** network calls in one `api` module (e.g. an axios instance with the base URL + a
> Bearer interceptor) and one function per endpoint, named after it. Components call those functions
> only — no inline fetch, no data reshaping."

This is the key to easy integration: the new UI's `api.js` becomes a near-drop-in replacement.

**4. Describe the core flows it must model** (so screens map to real endpoints):
> - **Login** → store token.
> - **Resources page**: `GET /resources` + `GET /availability/day?date=` for free/busy dots + a
>   free-slot finder (`GET /availability/free-slots`).
> - **Create event**: `POST /clashes/preview` live as the user edits, then `POST /events`. On a venue
>   clash, offer Request-Release (`POST /release-requests` with `proposed_event`).
> - **Groups & roster**: the `/groups` + `/roster` endpoints.
> - **Requests dashboard**: `/release-requests/incoming|outgoing`, accept with
>   `{mode:'cancel'|'shift'}`.
> - **Calendar**: `GET /events/calendar?start=&end=`; edits via `PATCH /events/{id}`.

**5. Tell it to flag gaps, not invent them:**
> "If a screen needs data this API doesn't expose, **list it as a 'backend gap'** instead of assuming
> a new endpoint. I'll add those endpoints."

**6. Match the existing client (optional but ideal).** This app's current client is
`frontend/src/lib/api.js` (axios + JWT interceptor) and Zustand for the auth store. Asking Claude to
follow that same pattern means the new UI can reuse the exact same `api.js`.

**Integration checklist when you bring the new UI in:**
- Point its API base at `/api/v1` (keep the Vite proxy, or set `VITE_API_URL`).
- Confirm it reads the JWT exactly as login returns it.
- Diff its endpoint calls against `openapi.json` — any mismatch is a quick rename.
- Anything in its "backend gaps" list → tell me and I'll add the endpoint.
