"""
Loads a real snapshot of the VM's production data (captured via `pg_dump
--data-only --column-inserts --disable-triggers`) into the local database.

Run once, AFTER the schema exists. NOTE: `alembic upgrade head` is NOT
enough — 001_initial_schema.py is only a historical baseline. This project
builds its live schema from the models via create_all() (see main.py), so
create the schema with:

    dropdb rsp_db && createdb rsp_db
    python -c "from app.core.database import Base, engine; \
               from app.modules import models; \
               Base.metadata.create_all(bind=engine)"

then:
    python seed_from_vm.py

Excludes audit_logs / notifications / refresh_tokens (log-style tables,
and refresh_tokens are tied to the VM's SECRET_KEY anyway, so they
wouldn't validate here regardless).
"""
import os

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
SQL_FILE = os.path.join(os.path.dirname(__file__), "rsp_data_dump.sql")


def main():
    with open(SQL_FILE, "r", encoding="utf-8") as f:
        sql = f.read()

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("VM data loaded successfully.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
