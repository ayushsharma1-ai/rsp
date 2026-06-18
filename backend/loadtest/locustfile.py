"""
Load test for the RSP backend, using Locust.

WHAT THIS DOES
  Spawns many "virtual users" that hit the backend like the real app does
  (mostly polling reads: calendar, notifications, bookings, resources) so you
  can see how response times and error rates behave under load.

INSTALL (into your existing venv):
    cd backend
    ..\\venv\\Scripts\\python.exe -m pip install locust

RUN (start the backend first, on :8000):
    ..\\venv\\Scripts\\python.exe -m locust -f loadtest/locustfile.py --host http://localhost:8000
  then open  http://localhost:8089  in a browser, enter:
    - Number of users      (e.g. 50)
    - Ramp up (users/sec)  (e.g. 5)
  and click Start. Watch the Statistics + Charts tabs.

WHY WE LOG IN ONLY ONCE
  /auth/login is rate-limited to 5 requests/min per IP. If every virtual user
  logged in, we'd just be testing the rate limiter. So we fetch ONE token at
  test start and every virtual user reuses it (the server just decodes the JWT
  per request — it doesn't care that they share one). For capacity testing of
  the read endpoints this is exactly what we want.

TWO WAYS TO USE IT
  1. Realistic ("can it handle my expected traffic?"): set wait_time to
     between(20, 30) below and run ~75 users — that mimics 75 people whose
     screens poll every ~25s.
  2. Stress ("where does it break?"): keep the short wait_time below and ramp
     users up (25 → 50 → 100 → 200 …) until p95 latency spikes or failures
     appear. That point is your ceiling.
"""
import os
import datetime
from locust import HttpUser, task, between, events

EMAIL = os.environ.get("LOADTEST_EMAIL", "admin@rsp.edu")
PASSWORD = os.environ.get("LOADTEST_PASSWORD", "admin123")

TOKEN = {"value": None}   # shared token, filled once at test start


@events.test_start.add_listener
def _login_once(environment, **kwargs):
    """Runs once when you click Start: log in and stash one token for everyone."""
    import requests
    host = (environment.host or "http://localhost:8000").rstrip("/")
    r = requests.post(f"{host}/api/v1/auth/login",
                      json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    TOKEN["value"] = r.json()["access_token"]
    print(f"[loadtest] got shared token for {EMAIL}")


def _week_range():
    today = datetime.date.today()
    start = today.isoformat() + "T00:00:00Z"
    end = (today + datetime.timedelta(days=7)).isoformat() + "T00:00:00Z"
    return start, end


class RspUser(HttpUser):
    # STRESS default (short think-time so load builds fast as you add users).
    # For a REALISTIC polling test, change this to: between(20, 30)
    wait_time = between(1, 3)

    def on_start(self):
        # attach the shared token to this virtual user's session
        self.client.headers.update({"Authorization": f"Bearer {TOKEN['value']}"})

    # weights = relative frequency (calendar is hit most, like the real app)
    @task(5)
    def calendar(self):
        start, end = _week_range()
        # name= groups all these under one row in the stats (ignores the querystring)
        self.client.get(f"/api/v1/events/calendar?start={start}&end={end}",
                        name="GET /events/calendar")

    @task(3)
    def notifications(self):
        self.client.get("/api/v1/users/me/notifications", name="GET /users/me/notifications")

    @task(2)
    def bookings(self):
        self.client.get("/api/v1/bookings", name="GET /bookings")

    @task(1)
    def resources(self):
        self.client.get("/api/v1/resources", name="GET /resources")
