"""
Dummy roster loader (Phase 2 demo data).

Reads roster_dummy.csv and inserts roster_people + groups + memberships.
Idempotent: safe to run repeatedly — people are de-duplicated by email (then name),
groups by name, and memberships by (group, person).

The sample data has deliberate OVERLAPS so clash detection is easy to demo:
    First-year CS ∩ First-year Design = {Aarav Sharma}
    First-year CS ∩ M.Tech AI         = {Diya Patel, Kabir Singh}
So two same-time events targeting two overlapping cohorts will show a student clash.

Run from the backend dir with the project venv, e.g.:
    ..\venv\Scripts\python.exe seed_roster.py
"""

import csv
import os

from app.core.database import SessionLocal
from app.modules.models import RosterPerson, Group, GroupMember

CSV_PATH = os.path.join(os.path.dirname(__file__), "roster_dummy.csv")


def get_or_create_person(db, full_name, email):
    person = None
    if email:
        person = db.query(RosterPerson).filter(RosterPerson.email == email).first()
    if not person:
        person = db.query(RosterPerson).filter(RosterPerson.full_name == full_name).first()
    if not person:
        person = RosterPerson(full_name=full_name, email=email or None)
        db.add(person)
        db.flush()
    return person


def get_or_create_group(db, name):
    g = db.query(Group).filter(Group.name == name).first()
    if not g:
        g = Group(name=name, group_type="cohort")
        db.add(g)
        db.flush()
    return g


def ensure_member(db, group, person):
    exists = db.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.roster_person_id == person.id,
    ).first()
    if not exists:
        db.add(GroupMember(group_id=group.id, roster_person_id=person.id))
        return True
    return False


def main():
    db = SessionLocal()
    seen_people, seen_groups, new_members = set(), set(), 0
    try:
        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                name = row["full_name"].strip()
                email = (row.get("email") or "").strip()
                gname = row["group"].strip()
                person = get_or_create_person(db, name, email)
                group = get_or_create_group(db, gname)
                if ensure_member(db, group, person):
                    new_members += 1
                seen_people.add(email or name)
                seen_groups.add(gname)
        db.commit()
        print(f"Roster loaded: {len(seen_people)} unique people, "
              f"{len(seen_groups)} groups, {new_members} new memberships added.")
    except Exception as e:
        db.rollback()
        print("ERROR:", e)
    finally:
        db.close()


if __name__ == "__main__":
    main()
