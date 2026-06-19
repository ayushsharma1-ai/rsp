"""
One-time setup for the event-kinds feature. Idempotent — safe to run more than once.

  cd rsp/backend
  python create_event_kinds.py

It:
  1. creates the `event_kinds` table (via create_all) if it doesn't exist,
  2. adds the `events.event_kind_id` column if it doesn't exist (create_all won't
     alter an existing table, so this ALTER is explicit),
  3. seeds the default kinds: Class, Workshop, Talk.
"""

from sqlalchemy import text

from app.core.database import Base, engine, SessionLocal
from app.modules import models  # noqa: F401 — registers all models on Base
from app.modules.models import EventKind

SEED = [
    ("Class", "#d99a4e"),     # amber / gold (matches the accent)
    ("Workshop", "#4f8a80"),  # muted teal
    ("Talk", "#c06a43"),      # terracotta
]


def main():
    # 1. create event_kinds (and any other missing tables) — never alters existing ones
    Base.metadata.create_all(bind=engine)

    # 2. add events.event_kind_id if missing (Postgres supports IF NOT EXISTS)
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS event_kind_id UUID REFERENCES event_kinds(id)"
        ))

    # 3. seed the default kinds (skip any that already exist by name)
    db = SessionLocal()
    try:
        for name, color in SEED:
            k = db.query(EventKind).filter(EventKind.name == name).first()
            if k:
                k.color = color          # refresh colour to match the current theme
            else:
                db.add(EventKind(name=name, color=color))
        db.commit()
        kinds = db.query(EventKind).order_by(EventKind.name).all()
        print("event_kinds ready:", [(k.name, k.color) for k in kinds])
    finally:
        db.close()


if __name__ == "__main__":
    main()
