"""
seed_viewers.py - add 30 student "viewer" accounts and spread them across the
student cohort groups, with some students in MULTIPLE groups (intersecting) and
most in exactly one (mutually exclusive). This gives realistic student-clash
scenarios for testing.

For each person it:
  - creates a User (role=viewer) if the email is new,
  - creates a matching RosterPerson (linked to that user) if new,
  - adds the roster person to each of their groups (group_members) if not already.

It is ADDITIVE and safe to re-run (skips anything that already exists). It does
NOT delete or reset anything.

Run locally:
    cd backend
    ..\\venv\\Scripts\\python.exe seed_viewers.py

Run against PRODUCTION (after seed_production.py has created the groups):
    $env:DATABASE_URL = "postgresql://USER:PASS@HOST.../DBNAME"
    ..\\venv\\Scripts\\python.exe seed_viewers.py
"""
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.modules.models import User, UserRole, RosterPerson, Group, GroupMember

# group short-codes used below
M1 = "MDes 1st year"
M2 = "MDes 2nd year"
P = "PhD"

# (full name, [groups]). 25 are in exactly one group (mutually exclusive);
# 5 are in two groups (intersecting) -> they cause cross-cohort clashes.
STUDENTS = [
    # --- MDes 1st year only (12) ---
    ("Aarav Sharma", [M1]),
    ("Vivaan Patel", [M1]),
    ("Aditya Reddy", [M1]),
    ("Ananya Iyer", [M1]),
    ("Diya Nair", [M1]),
    ("Ishaan Gupta", [M1]),
    ("Kavya Menon", [M1]),
    ("Rohan Das", [M1]),
    ("Saanvi Rao", [M1]),
    ("Arjun Mehta", [M1]),
    ("Myra Joshi", [M1]),
    ("Reyansh Verma", [M1]),
    # --- MDes 2nd year only (8) ---
    ("Sai Krishnan", [M2]),
    ("Anika Bose", [M2]),
    ("Kabir Malhotra", [M2]),
    ("Aadhya Pillai", [M2]),
    ("Vihaan Chauhan", [M2]),
    ("Riya Banerjee", [M2]),
    ("Dhruv Kulkarni", [M2]),
    ("Tara Saxena", [M2]),
    # --- PhD only (5) ---
    ("Advait Deshpande", [P]),
    ("Nisha Agarwal", [P]),
    ("Karthik Subramanian", [P]),
    ("Meera Chopra", [P]),
    ("Aryan Bhat", [P]),
    # --- intersecting: MDes 1st + MDes 2nd (3) ---
    ("Ira Sengupta", [M1, M2]),
    ("Yash Thakur", [M1, M2]),
    ("Pooja Naidu", [M1, M2]),
    # --- intersecting: MDes 1st + PhD (2) ---
    ("Siddharth Ghosh", [M1, P]),
    ("Anjali Mishra", [M1, P]),
]


def email_for(name):
    return ".".join(name.lower().split()) + "@iitk.ac.in"


def password_for(name):
    return name.lower().split()[0] + "123"   # e.g. "aarav123"


def main():
    db = SessionLocal()
    try:
        # cache groups by name
        groups = {g.name: g for g in db.query(Group).all()}
        missing = [n for n in (M1, M2, P) if n not in groups]
        if missing:
            print("ERROR: these groups don't exist yet:", missing)
            print("Run seed_production.py (or create the groups) first.")
            return

        # existing lookups so re-running is safe
        users = {u.email: u for u in db.query(User).all()}
        roster = {p.email: p for p in db.query(RosterPerson).all() if p.email}
        existing_links = {
            (m.group_id, m.roster_person_id)
            for m in db.query(GroupMember).all()
        }

        new_users = new_roster = new_links = 0
        for name, group_names in STUDENTS:
            email = email_for(name)

            # 1) user (viewer)
            user = users.get(email)
            if not user:
                user = User(
                    email=email, full_name=name,
                    hashed_password=get_password_hash(password_for(name)),
                    role=UserRole.VIEWER, is_active=True,
                )
                db.add(user); db.flush()
                users[email] = user
                new_users += 1

            # 2) roster person (linked to the user)
            person = roster.get(email)
            if not person:
                person = RosterPerson(full_name=name, email=email, user_id=user.id)
                db.add(person); db.flush()
                roster[email] = person
                new_roster += 1

            # 3) group memberships
            for gname in group_names:
                g = groups[gname]
                if (g.id, person.id) not in existing_links:
                    db.add(GroupMember(group_id=g.id, roster_person_id=person.id))
                    existing_links.add((g.id, person.id))
                    new_links += 1

        db.commit()

        print("Done.")
        print(f"  viewer users added : {new_users}")
        print(f"  roster people added: {new_roster}")
        print(f"  group links added  : {new_links}")
        for gname in (M1, M2, P):
            g = groups[gname]
            cnt = db.query(GroupMember).filter(GroupMember.group_id == g.id).count()
            print(f"  {gname}: {cnt} members")
        print("\nSample login: aarav.sharma@iitk.ac.in / aarav123  (role: viewer)")
        print("Intersecting students (in 2 groups): Ira Sengupta, Yash Thakur,")
        print("  Pooja Naidu (MDes 1st+2nd); Siddharth Ghosh, Anjali Mishra (MDes 1st+PhD).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
