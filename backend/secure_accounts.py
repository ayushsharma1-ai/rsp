"""
Pre-launch account hardening. Run ONCE against the PRODUCTION database, before going public.

  python secure_accounts.py                 # DRY RUN — just reports what it would change
  ADMIN_EMAIL=you@iitk.ac.in ADMIN_PASSWORD='Strong#Pass123' python secure_accounts.py --apply

What it does (with --apply):
  1. Disables the built-in DEMO accounts (admin@rsp.edu, alice/bob/carol@rsp.edu).
  2. If ADMIN_EMAIL/ADMIN_PASSWORD are set, (re)sets that account to a strong password + admin role.
  3. Finds every account still using the guessable "<firstname>123" seed password and resets it
     to a random strong one, writing new_passwords.csv (email,password) for you to distribute —
     then DELETE that file once shared.

Why: the seed scripts used known/guessable passwords (admin123, firstname123). On a public URL
those are an open door, so none may survive launch.
"""

import os
import sys
import csv
import secrets
import string

from app.core.database import SessionLocal
from app.core.security import get_password_hash, verify_password
from app.modules.models import User, UserRole

DEMO_EMAILS = {"admin@rsp.edu", "alice@rsp.edu", "bob@rsp.edu", "carol@rsp.edu"}
ALPHABET = string.ascii_letters + string.digits + "!@#$%*?"


def strong_password(n: int = 14) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def firstname_guess(email: str) -> str:
    # first.last@domain -> "first123" (the seed-script scheme)
    return email.split("@")[0].split(".")[0].lower() + "123"


def main(apply: bool) -> None:
    db = SessionLocal()
    reset_list = []
    try:
        # 1. disable demo accounts
        for email in DEMO_EMAILS:
            u = db.query(User).filter(User.email == email).first()
            if u and u.is_active:
                print(f"[demo]  {'disabling' if apply else 'would disable'}: {email}")
                if apply:
                    u.is_active = False

        # 2. ensure a real admin from env
        ae, ap = os.environ.get("ADMIN_EMAIL"), os.environ.get("ADMIN_PASSWORD")
        if ae and ap:
            u = db.query(User).filter(User.email == ae).first()
            print(f"[admin] {'setting' if apply else 'would set'} strong password + admin: {ae}")
            if apply:
                if u:
                    u.hashed_password = get_password_hash(ap)
                    u.role = UserRole.ADMIN
                    u.is_active = True
                else:
                    db.add(User(email=ae, full_name="Administrator",
                                hashed_password=get_password_hash(ap),
                                role=UserRole.ADMIN, is_active=True))
        else:
            print("[admin] (skip) set ADMIN_EMAIL and ADMIN_PASSWORD to (re)set your real admin")

        # 3. reset any account still using the guessable "<firstname>123" password
        for u in db.query(User).all():
            if u.email in DEMO_EMAILS:
                continue
            try:
                weak = verify_password(firstname_guess(u.email), u.hashed_password)
            except Exception:
                weak = False
            if weak:
                if apply:
                    np = strong_password()
                    u.hashed_password = get_password_hash(np)
                    reset_list.append((u.email, np))
                    print(f"[weak]  reset: {u.email}")
                else:
                    print(f"[weak]  would reset (guessable password): {u.email}")

        if apply:
            db.commit()
            if reset_list:
                with open("new_passwords.csv", "w", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(["email", "new_password"])
                    w.writerows(reset_list)
                print(f"\nWrote {len(reset_list)} new passwords to new_passwords.csv — "
                      f"distribute securely, then DELETE the file.")
            print("Done.")
        else:
            print("\nDRY RUN — nothing changed. Re-run with --apply to execute.")
    finally:
        db.close()


if __name__ == "__main__":
    main("--apply" in sys.argv)
