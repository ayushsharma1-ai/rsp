"""
Seed the DEPARTMENT reference data the v3 app expects: the fixed rooms and groups.
Idempotent — safe to run repeatedly (skips anything already present).

  cd /opt/rsp/backend && ./venv/bin/python seed_reference.py

WHY THIS IS NEEDED: the v3 UI shows a FIXED list of venues (601H-N/O/P) and groups
(MDes 1st year, ...). It maps each to a REAL row in the database BY NAME, so that room
bookings, clash detection, and slot-requests actually work. With no rows to match,
picking a venue books nothing, nothing can clash, and the "Request" button never shows.
"""
from app.core.database import Base, engine, SessionLocal
from app.modules import models  # noqa: F401 — registers models on Base
from app.modules.models import Resource, ResourceType, Group

# names MUST match the fixed venue keys in frontend/src/v3/config.js (normalised match)
ROOMS = [
    ("601H-N", "Computer room", ResourceType.COMPUTER_ROOM),
    ("601H-O", "Classroom",     ResourceType.CLASSROOM),
    ("601H-P", "Classroom",     ResourceType.CLASSROOM),
]
# names MUST match the fixed group labels in config.js
GROUPS = [
    ("MDes 1st year", "year"),
    ("MDes 2nd year", "year"),
    ("PhD",           "cohort"),
    ("Faculties",     "role"),
    ("Staff",         "role"),
]


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for name, desc, rtype in ROOMS:
            if db.query(Resource).filter(Resource.name == name).first():
                print(f"[room]  = {name} (exists)")
            else:
                db.add(Resource(name=name, description=desc, resource_type=rtype,
                                location="601H", requires_approval=False, is_active=True))
                print(f"[room]  + {name}")
        for name, gtype in GROUPS:
            if db.query(Group).filter(Group.name == name).first():
                print(f"[group] = {name} (exists)")
            else:
                db.add(Group(name=name, group_type=gtype))
                print(f"[group] + {name}")
        db.commit()
        print("Reference data ready.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
