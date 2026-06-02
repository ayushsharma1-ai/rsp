# Resource Scheduling Platform (RSP)

A production-grade collaborative scheduling platform built with FastAPI + PostgreSQL + React.

---

## Architecture

```
rsp/
├── backend/               FastAPI + SQLAlchemy + PostgreSQL
│   ├── app/
│   │   ├── core/          Config, DB engine, security, event bus
│   │   ├── modules/       Domain modules (models, services per domain)
│   │   │   ├── auth/      JWT auth, role guards
│   │   │   ├── bookings/  Events, bookings, FSM, conflict detection
│   │   │   ├── resources/ Generic resource management
│   │   │   ├── users/     User management, notifications
│   │   │   └── notifications/  Event-driven notification handlers
│   │   └── api/v1/routes/ HTTP endpoints (thin — call services)
│   └── seed.py            Demo data seeder
└── frontend/              React + Vite + Zustand
    └── src/
        ├── pages/         Full page components
        ├── components/    Reusable UI + layout
        ├── store/         Zustand auth store
        └── lib/           Axios API client
```

---

## Prerequisites

- Python 3.11+
- PostgreSQL 14+ running locally
- Node.js 18+

---

## Backend Setup

```bash
cd backend

# 1. Create database
createdb rsp_db
# OR via psql:  CREATE DATABASE rsp_db;

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env — update DATABASE_URL and SECRET_KEY

# 5. Start the API server
uvicorn app.main:app --reload --port 8000

# 6. (New terminal, same venv) Seed demo data
python seed.py
```

API docs available at: http://localhost:8000/docs

---

## Frontend Setup

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Start dev server (proxies /api → localhost:8000)
npm run dev
```

App available at: http://localhost:5173

---

## Demo Credentials

| Email             | Password  | Role      |
|-------------------|-----------|-----------|
| admin@rsp.edu     | admin123  | Admin     |
| alice@rsp.edu     | alice123  | Professor |
| bob@rsp.edu       | bob123    | Professor |
| carol@rsp.edu     | carol123  | Staff     |

---

## Features

- **Auth**: JWT login/register, role-based access (admin/professor/staff/viewer)
- **Dashboard**: Stats overview, upcoming events, recent bookings
- **Calendar**: Weekly grid view, create events with optional resource booking
- **Bookings**: List/filter/approve/reject/cancel bookings with FSM enforcement
- **Resources**: Browse rooms, labs, equipment; admin can add/edit
- **Notifications**: Event-driven, populated via internal event bus
- **Users** (admin only): View all users, change roles, deactivate accounts

---

## Key Architecture Decisions

### Why separate Event from Booking?
An Event is WHAT is happening. A Booking is a time-window claim on a Resource.
One event can book multiple resources. Events can exist without resource bookings.

### Why SELECT FOR UPDATE for conflict detection?
Prevents two concurrent requests from both passing the conflict check and creating overlapping bookings. The pessimistic lock forces serial execution.

### Why an event bus?
`BookingService` never imports `NotificationService`. It emits `booking.approved` and moves on. The notification module subscribes independently — decoupled, replaceable, async-ready.

### Why RFC 5545 RRULE for recurrence?
Avoids row explosion. A weekly class for 20 weeks = 1 RecurrenceRule row, not 20 Event rows. Industry-standard format supported by python-dateutil.
