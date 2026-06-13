# Resource Scheduling Platform (RSP)

## What this project is

A production-grade collaborative scheduling platform built for universities and organizations. Professors and staff can schedule meetings, reserve classrooms, book labs and equipment, and manage recurring semester timetables — all through a shared calendar interface.

The project was built as a learning vehicle for production backend architecture, system design, domain modeling, and scalable engineering patterns — not just as a functional app.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI |
| Database | PostgreSQL |
| ORM | SQLAlchemy 2.0 |
| Auth | JWT (python-jose) |
| Frontend | React 18, Vite |
| State | Zustand |
| Deployment | Render (backend), Vercel (frontend) |

---

## Architecture

### Pattern: Modular Monolith

One deployed application, internally structured as independent domain modules. Each module owns its service, data access, and has no direct imports from other modules (except through the event bus).

```
rsp/
├── backend/
│   ├── app/
│   │   ├── core/              # Infrastructure — config, DB, security, event bus, recurrence engine
│   │   │   ├── config.py      # Pydantic settings from .env
│   │   │   ├── database.py    # SQLAlchemy engine, SessionLocal, get_db()
│   │   │   ├── security.py    # JWT creation/decoding, bcrypt password hashing
│   │   │   ├── events.py      # In-process event bus (publish/subscribe)
│   │   │   ├── limiter.py     # slowapi rate limiter instance
│   │   │   └── recurrence.py  # RFC 5545 RRULE expansion engine (python-dateutil)
│   │   ├── modules/           # Domain modules
│   │   │   ├── models.py      # All SQLAlchemy models (single file to avoid circular imports)
│   │   │   ├── auth/          # JWT auth, role guards, get_current_user dependency
│   │   │   ├── bookings/      # Events, bookings, FSM, conflict detection, recurring events
│   │   │   ├── resources/     # Generic resource management (rooms, labs, equipment)
│   │   │   ├── users/         # User management, notifications
│   │   │   ├── notifications/ # Event-driven notification handlers (subscribes to event bus)
│   │   │   └── feedback/      # User feedback widget backend
│   │   └── api/v1/routes/     # HTTP layer — thin routes that call services
│   ├── alembic/               # Database migrations
│   ├── seed.py                # Demo data seeder
│   └── requirements.txt
└── frontend/
    └── src/
        ├── pages/             # One component per page
        ├── components/        # Reusable UI primitives + layout
        ├── store/             # Zustand auth store
        └── lib/               # Axios API client with JWT interceptor
```

---

## Domain model

Three core concepts kept deliberately separate:

**Event** — WHAT is happening (a lecture, meeting, seminar). Owns title, time, organizer, visibility.

**Booking** — a CLAIM on a Resource for a time window. Linked to an Event. One Event can have multiple Bookings (room + projector + lab).

**Resource** — a physical thing that can be reserved. Generic abstraction — classrooms, labs, equipment all live under one model with a `resource_type` enum.

### Database tables

| Table | Purpose |
|---|---|
| `users` | Identity and roles (admin/professor/staff/viewer) |
| `events` | Events — one-off, recurring roots, and exception occurrences |
| `recurrence_rules` | RFC 5545 RRULE strings — one row per recurring series |
| `bookings` | Resource reservations — one-off and recurring templates |
| `resources` | Rooms, labs, equipment |
| `event_participants` | Many-to-many: event ↔ user (RSVP) |
| `notifications` | User notifications — written by event bus handlers |
| `audit_logs` | Append-only history of every action |
| `feedback` | User feedback submissions with page and browser metadata |

---

## Key architectural patterns

### Request isolation
Every HTTP request gets its own SQLAlchemy session via `Depends(get_db())`. Sessions are created fresh per request and closed in a `finally` block. No shared mutable state between requests.

### Booking FSM (Finite State Machine)
```
PENDING → APPROVED → CONFIRMED → CANCELLED
PENDING → CONFIRMED  (auto-approve resources)
PENDING → REJECTED
```
Invalid transitions raise 400. Modeled as a dict in `bookings/service.py`.

### Conflict detection
Two-phase check in `_create_booking`:
1. SQL query for overlapping one-off bookings (`SELECT FOR UPDATE` for race condition safety)
2. Python loop expanding recurring template bookings via RRULE and checking overlap

### Recurring events — no row explosion
A semester course meeting every Monday and Wednesday for 16 weeks = **3 database rows**:
- 1 `RecurrenceRule` row with `FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=...`
- 1 `Event` row (the recurring root, `is_recurring_root=True`)
- 1 `Booking` row (the template, `is_recurring_template=True`)

Actual occurrences are generated at runtime by `core/recurrence.py` using `python-dateutil.rrulestr`.

### Exception occurrences
Editing or cancelling a single occurrence of a recurring series creates an **exception Event row**:
```
parent_event_id = <root event id>    — links to the series
occurrence_date = <original slot>    — identifies which occurrence is replaced
start_time      = <new time>         — the actual change
status          = CONFIRMED or CANCELLED
```
The calendar rendering suppresses the RRULE-generated occurrence and shows the exception instead.

### Event bus (decoupled side effects)
`BookingService` never imports `NotificationService`. It publishes domain events:
```python
bus.publish("booking.approved", {"booking_id": ..., "actor_id": ...})
```
`NotificationService` subscribes independently at startup. Swappable for Redis/Celery with no changes to business logic.

### Rate limiting
Auth endpoints protected with `slowapi`:
- `POST /auth/login` — 5 requests/minute per IP
- `POST /auth/register` — 10 requests/minute per IP

---

## API structure

All routes versioned under `/api/v1/`.

```
POST   /auth/login                          Login, returns JWT
POST   /auth/register                       Register new user
GET    /auth/me                             Current user info

GET    /events                              List events
POST   /events                             Create one-off event with bookings
POST   /events/recurring                   Create recurring event series
GET    /events/calendar?start=&end=        Calendar view (expands RRULEs)
GET    /events/{id}                        Event detail with bookings
PATCH  /events/{id}                        Update event or single occurrence
POST   /events/{id}/cancel                 Cancel event or single occurrence
DELETE /events/{id}/series                 Delete entire recurring series
POST   /events/{id}/cancel-occurrence      Cancel one occurrence
POST   /events/{id}/edit-occurrence        Edit one occurrence

GET    /bookings                           List bookings (admin sees all)
PATCH  /bookings/{id}/review               Approve or reject
PATCH  /bookings/{id}/cancel               Cancel booking
PATCH  /bookings/{id}                      Edit booking time/notes

GET    /resources                          List resources
POST   /resources                          Create resource (admin only)
PATCH  /resources/{id}                     Update resource (admin only)
DELETE /resources/{id}                     Deactivate resource (admin only)

GET    /users                              List users (admin only)
GET    /users/me/notifications             Current user's notifications
POST   /users/me/notifications/read        Mark all notifications read
PATCH  /users/{id}                         Update user role/status (admin only)

POST   /feedback                           Submit feedback
GET    /feedback                           List all feedback (admin only)
```

---

## Running locally

### Prerequisites
- Python 3.11+
- PostgreSQL 14+
- Node.js 20+

### Backend
```bash
cd rsp/backend
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux
pip install -r requirements.txt
pip install "bcrypt==4.0.1"    # pin for passlib compatibility
cp .env.example .env           # edit DATABASE_URL and SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

### Seed demo data (once)
```bash
python seed.py
```

### Frontend
```bash
cd rsp/frontend
npm install
npm run dev                    # → http://localhost:5173
```

### Demo accounts
| Email | Password | Role |
|---|---|---|
| admin@rsp.edu | admin123 | Admin |
| alice@rsp.edu | alice123 | Professor |
| bob@rsp.edu | bob123 | Professor |
| carol@rsp.edu | carol123 | Staff |

---

## Environment variables

### Backend `.env`
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/rsp_db
SECRET_KEY=your-secret-key-min-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=10080
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...   # optional
```

### Frontend (Vercel environment variables)
```
VITE_API_URL=https://your-backend.onrender.com/api/v1
```

---

## Database migrations

Alembic is configured. For any model change:

```bash
cd rsp/backend

# Generate migration from model diff
alembic revision --autogenerate -m "describe your change"

# Apply to database
alembic upgrade head

# For existing database already set up by create_all
alembic stamp head   # marks as already at this revision

# Roll back one migration
alembic downgrade -1
```

---

## Deployment

| Service | Platform | URL |
|---|---|---|
| Backend API | Render | https://scheduler-q5d3.onrender.com |
| Frontend | Vercel | your-vercel-url.vercel.app |

### Render (backend)
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Python version: set `PYTHON_VERSION=3.11.9` in environment variables

### Vercel (frontend)
- Root directory: `rsp/frontend`
- Build command: `npm install && npm run build`
- Output directory: `dist`
- Node version: 20.x

---

## What was intentionally learned building this

- Production-grade FastAPI architecture (dependency injection, service layer, route layer separation)
- SQLAlchemy session isolation and per-request DB session lifecycle
- Finite State Machine for booking workflow
- Pessimistic locking (`SELECT FOR UPDATE`) for race condition prevention
- RFC 5545 RRULE recurrence modeling without row explosion
- Exception occurrence pattern for editing/cancelling single occurrences
- Event-driven architecture with an internal event bus
- Composite key pattern for calendar blocks (recurring events share event id but need unique UI keys)
- ASGI concurrency model — event loop, thread pool, sync vs async routes
- Connection pooling and what happens under concurrent load
- JWT authentication flow
- Rate limiting on sensitive endpoints
- Alembic migration workflow
- Deploying FastAPI to Render and React/Vite to Vercel
