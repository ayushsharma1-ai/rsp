"""
seed_production.py - FRESH rebuild + seed of the production database.

WARNING - DESTRUCTIVE: wipes EVERY table, recreates the schema from the current
models, then seeds users, rooms, groups and the faculty roster. Use this once to
bring a production DB (created from an old commit) fully in line with the code.

Safety: it refuses to run unless you pass --reset, so you can't nuke a DB by
accident.

Usage (PowerShell), pointing at the PRODUCTION database:
    $env:DATABASE_URL = "postgresql://USER:PASS@HOST:PORT/DBNAME"
    venv\\Scripts\\python.exe seed_production.py --reset

It reads DATABASE_URL the same way the app does, so whatever that variable points
to is what gets rebuilt. DOUBLE-CHECK it before running.
"""
import sys
from app.core.database import engine, SessionLocal, Base
from app.core.security import get_password_hash
from sqlalchemy import text
# import models so Base.metadata knows every table before create_all
from app.modules import models  # noqa: F401
from app.modules.models import (
    User, UserRole, Resource, ResourceType, Group, RosterPerson, GroupMember,
)

# ── data to seed (mirrors the current local setup) ──────────────────────────
ADMIN = ("admin@rsp.edu", "Admin User", "admin123", UserRole.ADMIN)

FACULTY = [
    "Amar Kumar Behera", "Ashish Kumar Singh", "Girish Ishwar Lone",
    "Gowdham Prabhakar", "Himanshi Jangir", "J Ramkumar", "Mainak Das",
    "Nilutpal Borgohain", "Rajeev Jindal", "Satyaki Roy", "Shatarupa Roy",
    "Shoubhik Dutta Roy", "Subhajit Chandra", "Vivek Kant",
]

# name, type(value), location, capacity, requires_approval
RESOURCES = [
    ("Room A101", "classroom", "Building A", 120, False),
    ("Room B204", "seminar_hall", "Building B", 30, False),
    ("CS Lab 1", "lab", "Building C", 40, True),
    ("Conference Room 1", "meeting_room", "Admin Block", 15, True),
    ("Physics Lab", "lab", "Building D", 25, True),
    ("Projector Cart #1", "equipment", "AV Storage", None, False),
    ("605H-A", "lab", "5th Floor DJAC", 10, False),
    ("605H-B", "lab", "5th Floor DJAC", 10, False),
    ("605H-C", "lab", "5th Floor DJAC", 10, False),
    ("605H-D", "lab", "5th Floor DJAC", 10, False),
    ("605H-E", "lab", "5th Floor DJAC", 10, False),
    ("605H-F", "lab", "5th Floor DJAC", 10, False),
    ("606H", "lab", "5th Floor DJAC", 10, False),
    ("604H", "lab", "5th Floor DJAC", 10, False),
    ("602H", "lab", "5th Floor DJAC", 10, False),
    ("603H", "lab", "5th Floor DJAC", 10, False),
    ("601H-N", "lab", "5th Floor DJAC", 10, False),
    ("601H-0", "classroom", "5th Floor DJAC", 50, False),   # note: stored with a zero
    ("601H-P", "classroom", "5th Floor DJAC", 50, False),
]

# name, group_type
GROUPS = [
    ("First year MDES", "HMI"),
    ("First-year CS", "cohort"),
    ("First-year Design", "cohort"),
    ("M.Tech AI", "cohort"),
    ("MDes 1st year", "cohort"),
    ("MDes 2nd year", "cohort"),
    ("PhD", "cohort"),
    ("Faculties", "faculty"),
    ("Staff", "staff"),
]


def email_for(name):
    parts = name.lower().split()
    return parts[0] + ("." + parts[-1] if len(parts) > 1 else "") + "@iitk.ac.in"


def password_for(name):
    parts = name.lower().split()
    base = parts[0] if len(parts[0]) > 2 else parts[-1]   # "J Ramkumar" -> ramkumar123
    return base + "123"


def main():
    if "--reset" not in sys.argv:
        print(__doc__)
        print("Refusing to run without --reset. Nothing changed.")
        return

    print("Target database:", engine.url)            # sanity-check what you're about to wipe
    print("Dropping and recreating the public schema...")
    with engine.begin() as conn:
        # full clean slate — also clears leftover ENUM types, unlike drop_all
        conn.execute(text("DROP SCHEMA public CASCADE;"))
        conn.execute(text("CREATE SCHEMA public;"))

    print("Creating all tables from the current models...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # users: admin + faculty (faculty are professors)
        email, full_name, pwd, role = ADMIN
        db.add(User(email=email, full_name=full_name,
                    hashed_password=get_password_hash(pwd), role=role, is_active=True))
        for name in FACULTY:
            db.add(User(email=email_for(name), full_name=name,
                        hashed_password=get_password_hash(password_for(name)),
                        role=UserRole.PROFESSOR, is_active=True))

        # resources
        for name, rtype, loc, cap, appr in RESOURCES:
            db.add(Resource(name=name, resource_type=ResourceType(rtype),
                            location=loc, capacity=cap, requires_approval=appr, is_active=True))

        # groups
        groups = {}
        for name, gtype in GROUPS:
            g = Group(name=name, description="", group_type=gtype)
            db.add(g); db.flush()
            groups[name] = g

        # roster: faculty people, linked into the Faculties group
        faculties = groups["Faculties"]
        for name in FACULTY:
            p = RosterPerson(full_name=name, email=email_for(name))
            db.add(p); db.flush()
            db.add(GroupMember(group_id=faculties.id, roster_person_id=p.id))

        db.commit()
        print("Seed complete:")
        print("  users      :", db.query(User).count(), "(admin + faculty)")
        print("  resources  :", db.query(Resource).count())
        print("  groups     :", db.query(Group).count())
        print("  roster     :", db.query(RosterPerson).count())
        print("  Faculties  :", db.query(GroupMember).filter(GroupMember.group_id == faculties.id).count(), "members")
        print("\nLogin: admin@rsp.edu / admin123  |  e.g. vivek.kant@iitk.ac.in / vivek123")
    finally:
        db.close()


if __name__ == "__main__":
    main()
