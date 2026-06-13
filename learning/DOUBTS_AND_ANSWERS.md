# RSP — Doubts & Answers

A running log of questions asked while learning this codebase, with answers.
Newest entries added at the bottom. (Maintained by Claude — just ask and it gets appended here.)

---

## Q1 (2026-06-10) — Why `class ReleaseStatus(str, enum.Enum)` + `Column(SAEnum(ReleaseStatus), default=..., nullable=False)` instead of plain strings?

The code in `models.py`:
```python
class ReleaseStatus(str, enum.Enum):
    REQUESTED = "requested"
    ACCEPTED_RELEASED = "accepted_released"
    ...

status = Column(SAEnum(ReleaseStatus), default=ReleaseStatus.REQUESTED, nullable=False)
```

A status can only ever be **one of a small, fixed, known set of values**. An *enum* makes
that rule explicit; a plain string column would accept literally anything. Here's each piece.

### Why an enum instead of a plain string?
1. **Controlled vocabulary — no typos, no drift.** With a plain string you could store
   `"requested"`, `"Requested"`, `"reqested"` (typo), `"pending"` … and nothing stops it.
   The enum says: the only legal values are these five. A typo becomes an *error*, not a
   silently-corrupt row.
2. **Database-level enforcement.** `SAEnum(...)` creates a Postgres `ENUM` type, so the
   **database itself** rejects any value outside the list — even a buggy script or hand-written
   SQL can't insert garbage. A `VARCHAR` would accept anything.
3. **Single source of truth.** The allowed states live in *one* class. The FSM, the service
   code, and the API all reference `ReleaseStatus.X`. Add/rename a state in one place.
4. **Safe comparisons + autocomplete.** `if req.status != ReleaseStatus.REQUESTED` — your
   editor autocompletes the members and flags misspellings. Scattered string literals
   (`"requestd"`) fail silently.

(If a field is genuinely free-form — a name, a note, an open-ended tag — *then* a plain string
is right. Enums are for a **small, stable set of mutually-exclusive states.**)

### Why `(str, enum.Enum)` specifically (a "string enum")?
This is a mixin: each member is **both a real `str` and an enum member**. So:
- `ReleaseStatus.REQUESTED == "requested"` is `True`.
- It serializes to JSON as the plain string `"requested"` automatically.

You get **enum safety inside Python** but **plain-string convenience at the boundaries**
(JSON responses, comparisons). Without the `str` mixin you'd have to write `.value` everywhere
and JSON output would be awkward. That's why the API returns `status: "accepted_released"`
(a string the React frontend reads) while the Python code works with a type-checked enum.

*(If you know Java: this is like `enum ReleaseStatus { ... }` that also behaves as its string
code. The DB `ENUM` type is like a `CHECK` constraint pinning the column to known values.)*

### Why `SAEnum(ReleaseStatus)` for the column?
`SAEnum` is SQLAlchemy's `Enum` column type — it maps the Python enum to a DB column. On
Postgres it makes a native `ENUM` type named `releasestatus` with the allowed labels.
> **Gotcha (we hit this):** SQLAlchemy stores the enum **member NAME** (`REQUESTED`, uppercase)
> as the DB label, while the API uses the **value** (`requested`). That's why adding a value
> later needs `ALTER TYPE releasestatus ADD VALUE 'NAME'`. See `DBMS_FOUNDATIONS.md` §10.

### Why `default=ReleaseStatus.REQUESTED`?
A Python-side default: create a `SlotReleaseRequest` without naming a status and SQLAlchemy
sets it to `REQUESTED` on insert. Every new request *starts* in the FSM's initial state — you
never set it by hand.

### Why `nullable=False`?
A release request must **always** have a status — there's no meaningful "no status." This adds
a `NOT NULL` constraint so the DB rejects a row with an empty status. Together with the default,
`status` is guaranteed to always be a valid one of the five values.

### The same pattern elsewhere
`BookingStatus`, `EventStatus`, `ResourceType`, `EventCategory`, `NotificationType`,
`UserRole` — all use this exact `(str, enum.Enum)` + `SAEnum(...)` pattern, for the same reasons.
`BookingStatus` and `ReleaseStatus` additionally drive **finite state machines** (the allowed
transitions are enforced in the service layer).

---

## Q2 (2026-06-10) — What is `_to_out(self, req)` in `ReleaseService`?

It's a **serializer / mapper**: it converts one database object (`SlotReleaseRequest`, a
SQLAlchemy ORM row, with relationships) into the **API response shape** (`ReleaseRequestOut`,
a Pydantic model = the JSON the frontend receives). Every release endpoint (create, incoming,
outgoing, accept, decline, cancel) calls it, so every response has the **same flat shape**.

```python
def _to_out(self, req: SlotReleaseRequest) -> ReleaseRequestOut:
    b = req.booking   # follow the FK to the Booking (lazy-loaded from the DB)
    return ReleaseRequestOut(
        id=req.id,
        booking_id=req.booking_id,
        status=req.status.value,                                   # enum → plain string
        ...
        requester_name=req.requester.full_name if req.requester else None,   # flatten + null-safe
        resource_name=b.resource.name if b and b.resource else None,         # chained null-safe
        ...
    )
```

**Piece by piece:**
- **`-> ReleaseRequestOut`** and the underscore name: a private helper that returns the Pydantic
  output model. (`_` = "internal, not part of the public API".)
- **`b = req.booking`** — follows the relationship from the request to its `Booking` (SQLAlchemy
  lazy-loads it using the `booking_id` FK). Saved in `b` so we don't write `req.booking` repeatedly.
- **`status=req.status.value`** — `req.status` is a `ReleaseStatus` enum member; `.value` gives the
  plain string (`"requested"`) for the JSON (see Q1).
- **`req.requester.full_name if req.requester else None`** — two jobs at once:
  1. **Flatten:** instead of returning the whole related `User`, pull out just `full_name`.
  2. **Null-safety:** `if req.requester else None` guards against a missing relationship so it
     doesn't crash with `AttributeError`. (Same idea as JS optional chaining `req.requester?.full_name`.)
- **`b.resource.name if b and b.resource else None`** — **chained** null-safety: the booking `b`
  might be `None`, and even if it exists its `resource` might be `None`; only when *both* exist do
  we read `.name`. Same for `event_title`, `start_time`, `end_time`.

**Why do it this way (vs returning the ORM object directly)?**
1. **Decouple the API from the DB.** The response is a curated, *flat* set of fields the frontend
   actually needs (names, titles, times) — not the raw nested ORM graph.
2. **Don't leak data.** Returning the related `User` object could expose `hashed_password` etc.
   Flattening to just `full_name` exposes only what's intended.
3. **JSON-friendly.** FastAPI serializes the Pydantic `ReleaseRequestOut`; raw ORM objects with
   relationships aren't directly serializable.
4. **DRY / consistency.** One function builds the shape; all six endpoints reuse it, so the JSON
   never drifts between endpoints.

**Why manual (not Pydantic's `from_attributes`)?** Pydantic can auto-copy *flat* matching
attributes, but it can't easily **flatten nested relationships** (`req.booking.resource.name`)
into top-level fields like `resource_name`. A hand-written `_to_out` does the flattening +
null-safety, which is exactly what the Requests dashboard needs to display each row.

---

## Q3 (2026-06-10) — Where is the `booking_id` in the "Send request" POST decided?

There are **two** "Send request" buttons; both `POST /release-requests {booking_id, message}`:

**(1) Create-event modal — venue clash** (most likely the one you clicked):
- Frontend `DashboardPage.jsx`: `onClick={() => sendRequest(vb.booking_id)}` where `vb` is one
  item of `c.venue_bookings`, and `clashes` is the **response of `POST /clashes/preview`**.
- So the id is actually chosen on the **backend**, in `clash/service.py → find_clashes`: for the
  room(s) you selected, it queries the *existing* booking on that resource at the overlapping
  time and returns its id as `venue_bookings[].booking_id`. That is the slot you'd be requesting.

**(2) Bookings page detail modal:**
- Frontend `BookingsPage.jsx → BookingDetailModal.requestSlot`: `booking_id: b.id`, where `b` is
  the booking row you opened (from `GET /bookings`).

**See it live:** DevTools → Network → open the `POST /clashes/preview` request → **Response** →
the `venue_bookings[].booking_id` is exactly the value the button sends.

---

## Q4 (2026-06-10) — Explain `_people_for_groups(group_ids)` in `clash/service.py`

```python
def _people_for_groups(self, group_ids) -> Set[str]:
    """Expand a set of group ids → the set of roster_person ids in them."""
    group_ids = list(group_ids or [])          # (1) normalise input
    if not group_ids:                           # (2) no groups → no people
        return set()
    rows = (
        self.db.query(GroupMember.roster_person_id)   # (3) SELECT roster_person_id
        .filter(GroupMember.group_id.in_(group_ids))  # (4) WHERE group_id IN (...)
        .distinct()                                   # (5) drop duplicates
        .all()                                         # (6) run it → list of rows
    )
    return {r[0] for r in rows}                  # (7) rows → a set of ids
```

**Job:** take some group ids and return the **set of all people** in those groups. It's the
"expand groups → people" step; the clash check then intersects two such sets.

1. **`group_ids = list(group_ids or [])`** — defensive cleanup. `group_ids or []` turns a
   `None`/empty value into `[]`; `list(...)` makes sure it's a list (SQLAlchemy's `.in_()` wants
   an iterable/list).
2. **`if not group_ids: return set()`** — early exit: no groups means no people, so return an
   empty set (also avoids a pointless `IN ()` query).
3. **`self.db.query(GroupMember.roster_person_id)`** — start a `SELECT` that returns **only the
   `roster_person_id` column** of the `group_members` table (not whole rows — just that column).
4. **`.filter(GroupMember.group_id.in_(group_ids))`** — the `WHERE` clause. `.in_(...)` is SQL's
   `IN` operator: "keep rows whose `group_id` is *any of* these ids."
5. **`.distinct()`** — `SELECT DISTINCT`: remove duplicate person ids. Needed because a person
   in *two* of the selected groups would otherwise appear twice (once per group).
6. **`.all()`** — actually execute the query against Postgres and return all matching rows as a
   Python list.
7. **`return {r[0] for r in rows}`** — a **set comprehension**:
   - `rows` is a list of **tuples**, because we selected a single column → each row looks like
     `("abc-123",)`. `r[0]` pulls the id string out of the 1-tuple.
   - `{ … for … }` (curly braces, no `key:value`) builds a **set** = unique, unordered.
   - Result: `{"abc-123", "def-456", …}` — the person ids in those groups.

**Plain English → SQL keyword** (how to read the query):
| Plain English | SQL |
|---|---|
| "look at the membership sign-up sheet" | `FROM group_members` (which table) |
| "give me just the person, not the whole row" | `SELECT roster_person_id` (which column) |
| "only rows whose group is one of mine" | `WHERE group_id IN (...)` (`IN` = "is any of these") |
| "no repeats" | `DISTINCT` |

**Equivalent SQL** (this is exactly what the ORM generates):
```sql
SELECT DISTINCT roster_person_id
FROM group_members
WHERE group_id IN (:g1, :g2, ...);
```

**Why return a set?** The clash check does `my_people & their_people` (set **intersection**) to
find shared students. Sets make that a one-liner with fast membership tests. So this method's
whole purpose is to produce the people-set that gets intersected.

**Worked example (dummy data):** selecting "First-year CS" → returns the set of its 8 people.
Another event on "M.Tech AI" → its 5 people. `CS_people & AI_people = {Diya, Kabir}` → 2 shared
students → student clash with count 2.

---

## Q5 (2026-06-10) — What is `candidates` in `find_clashes`?

**Plain English:** `candidates` is the **shortlist of events that *could* clash** with the one
you're proposing. The only events that can possibly clash are ones happening **at the same time**
(their time overlaps your window). So `candidates` = every event that overlaps your `[start, end)`,
**except** cancelled events, recurring-template rows, and the event itself. Overlapping in time is
*necessary but not enough* — so the `for` loop then inspects each candidate to see if it's a *real*
clash (shares a room, or shares students). Think of candidates as "the suspects"; the loop is the
investigation that decides which suspects are actually guilty.

**The query that builds it, mapped to SQL:**
```python
q = self.db.query(Event).filter(          # SELECT * FROM events
    Event.status != EventStatus.CANCELLED,#   WHERE status <> 'CANCELLED'
    Event.start_time < end,               #     AND start_time < :end   ┐ overlap
    Event.end_time > start,               #     AND end_time   > :start ┘ rule
    Event.is_recurring_root == False,     #     AND is_recurring_root = false
)
if exclude_event_id:
    q = q.filter(Event.id != exclude_event_id)  # AND id <> :exclude_id
candidates = q.all()                      # run it → a list of Event rows
```

| Plain English | SQL |
|---|---|
| "look at the events table (whole rows)" | `SELECT * FROM events` |
| "ignore cancelled events" | `WHERE status <> 'CANCELLED'` (`<>` = not equal) |
| "only events whose time overlaps mine" | `AND start_time < :end AND end_time > :start` |
| "skip recurring-series templates" | `AND is_recurring_root = false` |
| "don't compare an event with itself" | `AND id <> :exclude_id` |
| "run it, give me the rows" | `.all()` |

**New SQL words:** `SELECT *` (all columns), `<>` (not equal, same as `!=`), `AND` (combine
conditions), `false` (boolean). Also note: `query(Event)` returns **whole Event objects** (so in
the loop `ev.title`, `ev.start_time`, … all work), whereas `query(GroupMember.roster_person_id)`
in Q4 returned single-column tuples. Selecting a *model* → objects; selecting a *column* → tuples.

---

## Q6 (2026-06-10) — Why `resource_name=bk.resource.name if bk.resource else None`?

**Plain English:** `bk` is a booking. `bk.resource` means *"follow this booking to the room it
booked"* (via the `resource_id` link). `.name` then takes that room's name. So `bk.resource.name`
= "the name of the room this booking is for." The `if bk.resource else None` is a **safety check**:
*"if the room actually exists, use its name; otherwise put nothing (`None`) instead of crashing."*

**Why the guard matters:** if `bk.resource` were `None` (no room found), then asking for `.name`
on `None` throws `AttributeError` and the whole request 500s. The guard turns a possible crash
into a graceful blank. (`X.name if X else None` is Python's ternary: *use X.name when X exists,
else None*.)

**When could the room be missing?** In this app, basically never — `Booking.resource_id` is
required (`nullable=False`) and resources are *soft*-deleted (the row stays). So this is
**defensive programming**: a serializer that builds API output should never let one odd/legacy
row take down the endpoint. Same reason for `holder_name=bk.requester.full_name if bk.requester else None`.

**Map to SQL:** following a relationship like `bk.resource` is the ORM's version of a **JOIN** —
connecting two tables by matching a column:
```sql
SELECT r.name
FROM bookings b
LEFT JOIN resources r ON r.id = b.resource_id   -- connect booking → its resource
WHERE b.id = :bk_id;
```
| Plain English | SQL |
|---|---|
| "follow the booking to its room" | `JOIN resources r ON r.id = b.resource_id` |
| "...even if there's no room, keep going" | `LEFT JOIN` (fills missing room columns with `NULL`) |
| "take the room's name" | `SELECT r.name` |
| "if there's no room → blank" (`if bk.resource else None`) | the `NULL` a `LEFT JOIN` returns |

**New SQL words:** `JOIN` (connect two tables by a matching column), `LEFT JOIN` (keep the left
row even when the right has no match — its columns come back `NULL`), `NULL` (SQL's "no value",
which becomes `None` in Python / `null` in JSON).

---

## Q7 (2026-06-14) — Explain `ALTER TABLE events ADD COLUMN color VARCHAR(9);`

**Plain English:** A table is like a spreadsheet — each **row** is one event, each **column** is a
fact stored about every event. We wanted events to carry a personal color, which is a new fact, so
the table needs a new **column**. This statement adds it.

**Map each token to the SQL:**
| Token | Meaning |
|---|---|
| `ALTER TABLE` | change the **structure** of an existing table (its shape, not its rows) |
| `events` | which table |
| `ADD COLUMN` | the change — create a new column |
| `color` | the new column's name |
| `VARCHAR(9)` | type: **VAR**iable-length text, at most **9** characters |

**Why 9?** A hex color `#5b6ef5` is 7 chars (`#` + 6); with a transparency suffix `#5b6ef5ff` it's 9.
`VARCHAR` only uses the space it needs (unlike `CHAR(9)`, which always pads to 9).

**What about the events already in the table?** Each gets the new cell set to `NULL` ("unknown").
Our code treats `null` as "no custom color → use the default venue color".

**The deeper concept — why we ran it by hand.** Two pictures of the table must agree:
1. the app's **model** (the Python `Event` class with `color = Column(...)`) — what the app *thinks* exists, and
2. the **real table** in PostgreSQL.

This app builds its schema with SQLAlchemy `create_all()`, and the catch is: **`create_all` only
creates tables that don't exist yet — it never adds columns to a table that's already there.** So
editing the Python class did nothing to the existing table. Saving an event *with* a color into a
table that *has no* color column → mismatch → error. `ALTER TABLE` brings the real table back in
line with the model. That deliberate "reshape the live DB" step is a **migration** (big projects use
Alembic to generate/track these; we did this one manually).

**Why every environment needs it:** your laptop's DB and Render's DB are two separate databases,
each with its own copy of `events`. Running the ALTER on one doesn't touch the other.

**New SQL words:** `ALTER TABLE` (change a table's structure), `ADD COLUMN` (add a field),
`VARCHAR(n)` (text up to n chars). Safe pattern: check the column exists first (or
`ADD COLUMN IF NOT EXISTS`) because running it twice errors with "column already exists".

---

## Q8 (2026-06-14) — Client redirect vs `middleware.js` for "mobile → v3, desktop → v1"? Which is better?

**The one idea:** *where and when the "is this mobile?" decision is made.*

**Client-side redirect (what we use).** The decision happens **in the browser, after the page starts
loading.** Phone asks for `/` → server sends `index.html` → a tiny script runs → "this is mobile" →
browser asks *again* for `/v3.html`. Two round-trips; the URL changes to `/v3.html`. Like calling a
shop, them saying "call our other branch instead," and you dialing again.

**Edge middleware (`middleware.js`).** The decision happens **on the server, before any HTML is
sent.** Phone asks for `/` → Vercel's edge reads the `User-Agent` header → serves v3's content right
there at `/`. One round-trip; URL stays `/`. Like one phone number where a receptionist quietly
routes you.

| | Client redirect | Edge middleware |
|---|---|---|
| Decision made | browser, after load starts | server, before responding |
| Round-trips | 2 | 1 |
| URL shown | becomes `/v3.html` | stays `/` |
| Flash/delay | tiny flash possible | none |
| Detects device by | JS: User-Agent **+ touch + screen** | User-Agent header **only** |
| Setup | none (a `<script>`) | a `middleware.js` file, Vercel-only |
| Portability | any host | Vercel-specific |
| CDN-cache risk | low (different URLs) | needs `Vary: User-Agent` care |

**Better for THIS app: the client redirect.** Simpler, and actually *better* on two surprising
points: (1) **more accurate** — it can check touch + screen size, not just the User-Agent (which is
why iPads that pretend to be a Mac are hard for middleware); (2) **safer caching** — middleware
serves *different content at the same URL*, so a CDN can hand a cached mobile page to a desktop
unless `Vary: User-Agent` is set just right. Two different URLs can't have that bug.

**Middleware wins when** you go public-facing and need: zero flash, the URL to stay `/`, SEO, or
edge-scale routing — none of which apply to an internal ~15-user tool.

**Textbook-best for a public product is actually neither:** ship **one responsive app** so there's
no second build to route to. We have two versions on purpose (to compare), so routing is correct here.

