"""Seed the 14 design-dept faculty as professor login accounts.

- Emails/passwords are GUESSED sample data (first.last@iitk.ac.in / firstname123).
- Links each user to their RosterPerson row (roster.user_id) when names match.
- Removes the old demo professors/staff (alice, bob, carol) — falls back to
  deactivating them if other rows still reference them.

Run:  venv\\Scripts\\python.exe seed_faculty_users.py
"""
from app.core.database import SessionLocal
from app.core.security import get_password_hash, verify_password
from app.modules.models import User, RosterPerson

FACULTY = [
    'Amar Kumar Behera', 'Ashish Kumar Singh', 'Girish Ishwar Lone',
    'Gowdham Prabhakar', 'Himanshi Jangir', 'J Ramkumar', 'Mainak Das',
    'Nilutpal Borgohain', 'Rajeev Jindal', 'Satyaki Roy', 'Shatarupa Roy',
    'Shoubhik Dutta Roy', 'Subhajit Chandra', 'Vivek Kant',
]
REMOVE = ['alice@rsp.edu', 'bob@rsp.edu', 'carol@rsp.edu']


def email_for(name: str) -> str:
    parts = name.lower().split()
    return parts[0] + ('.' + parts[-1] if len(parts) > 1 else '') + '@iitk.ac.in'


def password_for(name: str) -> str:
    parts = name.lower().split()
    # single-letter first names (J Ramkumar) read badly as "j123" — use last name
    base = parts[0] if len(parts[0]) > 2 else parts[-1]
    return base + '123'


def main():
    db = SessionLocal()
    existing = {u.email for u in db.query(User).all()}
    roster = {p.full_name: p for p in db.query(RosterPerson).all()}

    created = []
    for name in FACULTY:
        email = email_for(name)
        pwd = password_for(name)
        if email not in existing:
            u = User(email=email, full_name=name,
                     hashed_password=get_password_hash(pwd),
                     role='professor', is_active=True)
            db.add(u)
            db.flush()
            created.append((name, email, pwd))
        else:
            u = db.query(User).filter(User.email == email).first()
        person = roster.get(name)
        if person is not None and person.user_id is None:
            person.user_id = u.id
    db.commit()

    removed, deactivated = [], []
    for email in REMOVE:
        u = db.query(User).filter(User.email == email).first()
        if not u:
            continue
        try:
            db.delete(u)
            db.commit()
            removed.append(email)
        except Exception:
            db.rollback()
            u = db.query(User).filter(User.email == email).first()
            u.is_active = False
            db.commit()
            deactivated.append(email)

    print(f'Created {len(created)} faculty accounts:')
    for name, email, pwd in created:
        print(f'  {name:22} | {email:32} | {pwd}')
    print('Removed:', removed)
    print('Deactivated (still referenced by old events/bookings):', deactivated)

    # sanity: one login round-trip through the real hash check
    probe = db.query(User).filter(User.email == email_for('Vivek Kant')).first()
    print('Password check (vivek):', verify_password(password_for('Vivek Kant'), probe.hashed_password))
    print('Active users now:', db.query(User).filter(User.is_active == True).count())  # noqa: E712
    db.close()


if __name__ == '__main__':
    main()
