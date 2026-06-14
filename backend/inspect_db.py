"""
inspect_db.py - list every table and its row count in whatever DATABASE_URL
points to. READ-ONLY: it only SELECTs, never changes anything. Handy for
confirming a seed/rebuild worked on a hosted DB (Neon, Render, etc.).

Local DB:
    cd backend
    ..\\venv\\Scripts\\python.exe inspect_db.py

Neon (or any hosted) DB:
    $env:DATABASE_URL = "postgresql://USER:PASS@ep-xxxx.aws.neon.tech/DBNAME?sslmode=require"
    ..\\venv\\Scripts\\python.exe inspect_db.py
"""
from sqlalchemy import inspect, text
from app.core.database import engine


def main():
    # show host/db only — never print the password
    print(f"Database: {engine.url.host}/{engine.url.database}\n")
    insp = inspect(engine)
    tables = insp.get_table_names()
    if not tables:
        print("No tables found (empty database).")
        return
    print(f"{len(tables)} tables:")
    with engine.connect() as conn:
        for t in sorted(tables):
            try:
                n = conn.execute(text(f'SELECT COUNT(*) FROM "{t}"')).scalar()
            except Exception as e:
                n = f"? ({e})"
            print(f"  {t:30} {n} rows")


if __name__ == "__main__":
    main()
