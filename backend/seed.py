"""
Run this once after starting the backend to populate demo data:
  cd backend && python seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from app.core.database import SessionLocal, Base, engine
from app.modules import models  # noqa
from app.modules.models import User, UserRole, Resource, ResourceType
from app.core.security import get_password_hash
from datetime import datetime, timedelta, timezone

Base.metadata.create_all(bind=engine)

db = SessionLocal()

def seed():
    if db.query(User).count() > 0:
        print("Already seeded. Delete the DB or truncate tables to re-seed.")
        return

    # Users
    admin = User(email="admin@rsp.edu", full_name="Admin User", hashed_password=get_password_hash("admin123"), role=UserRole.ADMIN)
    prof1 = User(email="alice@rsp.edu", full_name="Prof. Alice Chen", hashed_password=get_password_hash("alice123"), role=UserRole.PROFESSOR)
    prof2 = User(email="bob@rsp.edu", full_name="Prof. Bob Singh", hashed_password=get_password_hash("bob123"), role=UserRole.PROFESSOR)
    staff = User(email="carol@rsp.edu", full_name="Carol (Staff)", hashed_password=get_password_hash("carol123"), role=UserRole.STAFF)
    db.add_all([admin, prof1, prof2, staff])
    db.flush()

    # Resources
    resources = [
        Resource(name="Room A101", description="Main lecture hall, 120 seats", resource_type=ResourceType.CLASSROOM, location="Building A", capacity=120, requires_approval=False),
        Resource(name="Room B204", description="Seminar room, 30 seats", resource_type=ResourceType.SEMINAR_HALL, location="Building B", capacity=30, requires_approval=False),
        Resource(name="CS Lab 1", description="Computer Science Lab", resource_type=ResourceType.LAB, location="Building C", capacity=40, requires_approval=True),
        Resource(name="Conference Room 1", description="Executive conference room", resource_type=ResourceType.MEETING_ROOM, location="Admin Block", capacity=15, requires_approval=True),
        Resource(name="Physics Lab", description="Physics experimental lab", resource_type=ResourceType.LAB, location="Building D", capacity=25, requires_approval=True),
        Resource(name="Projector Cart #1", description="Mobile projector", resource_type=ResourceType.EQUIPMENT, location="AV Storage", capacity=None, requires_approval=False),
    ]
    db.add_all(resources)
    db.flush()

    # Events + Bookings
    from app.modules.models import Event, Booking, BookingStatus, EventStatus
    now = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)

    events_data = [
        {
            "title": "Advanced Algorithms Lecture",
            "organizer": prof1,
            "resource": resources[0],
            "start": now + timedelta(days=1),
            "end": now + timedelta(days=1, hours=2),
            "status": BookingStatus.CONFIRMED,
        },
        {
            "title": "Research Group Meeting",
            "organizer": prof1,
            "resource": resources[1],
            "start": now + timedelta(days=2),
            "end": now + timedelta(days=2, hours=1),
            "status": BookingStatus.CONFIRMED,
        },
        {
            "title": "CS Lab Session",
            "organizer": prof2,
            "resource": resources[2],
            "start": now + timedelta(days=1, hours=3),
            "end": now + timedelta(days=1, hours=5),
            "status": BookingStatus.PENDING,
        },
        {
            "title": "Department Strategy Meeting",
            "organizer": admin,
            "resource": resources[3],
            "start": now + timedelta(days=3),
            "end": now + timedelta(days=3, hours=2),
            "status": BookingStatus.CONFIRMED,
        },
        {
            "title": "Physics Experiment Session",
            "organizer": prof2,
            "resource": resources[4],
            "start": now + timedelta(days=4),
            "end": now + timedelta(days=4, hours=3),
            "status": BookingStatus.PENDING,
        },
    ]

    for ed in events_data:
        evt = Event(
            title=ed["title"],
            organizer_id=ed["organizer"].id,
            start_time=ed["start"],
            end_time=ed["end"],
            is_public=True,
            status=EventStatus.CONFIRMED,
        )
        db.add(evt)
        db.flush()
        bk = Booking(
            event_id=evt.id,
            resource_id=ed["resource"].id,
            requester_id=ed["organizer"].id,
            start_time=ed["start"],
            end_time=ed["end"],
            status=ed["status"],
        )
        db.add(bk)

    db.commit()
    print("✅ Seeded successfully!")
    print("\n📋 Demo credentials:")
    print("  admin@rsp.edu / admin123  (Admin)")
    print("  alice@rsp.edu / alice123  (Professor)")
    print("  bob@rsp.edu   / bob123    (Professor)")
    print("  carol@rsp.edu / carol123  (Staff)")

seed()
db.close()
