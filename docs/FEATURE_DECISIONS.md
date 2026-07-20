# RSP — Feature Decisions & Open Questions

Ideas that need a **team decision before building**, because they change how people
behave toward each other — not just what the software does.

**How to use this doc.** Each entry has: what it is · why we'd want it · the ways we
could build it · where it *contradicts* something we already decided · the *political
and social* issues it creates · open questions. Bring an entry to a meeting, decide,
then record the outcome in the **Decision log** at the bottom.

**Why "political issues" is a real heading.** A scheduling tool allocates a scarce
resource (rooms, time, attention) between colleagues of unequal seniority. Any rule we
encode — who wins a conflict, who may override whom, what happens when someone stays
silent — is a *policy decision about the department*, made by software. It's better to
choose those deliberately than to discover them after they've upset someone.

---

# 1. Cohort (student) clash detection

**Status:** built but switched OFF (`STUDENT_CLASH_ENABLED = False`).

## What it is
Groups (MDes 1st year, PhD, …) are rosters of people. The clash engine can expand
two events → their groups → the people in them, and detect when the *same students*
would have to be in two places at once. It reports the number of affected people.

Today the tag is stored and nothing reads it — no warning, no block.

## Hard prerequisite
This only works if groups have **members rostered**. Tagging an event with a group is
one tap; entering ~40 students per cohort is real, ongoing data-entry work. **If we
aren't willing to maintain rosters, options B–E below are not available at all.**

## Options

| | Option | Behaviour | Cost |
|---|---|---|---|
| **A** | Leave off | Today. Groups are labels only. | none |
| **B** | **Soft warning** | On create: *"MDes 1st year already has Studio then (23 students)"* — informational, you can proceed. | Small. Backend already computes it; the frontend currently discards it. |
| **C** | Hard block | Refuse to create (409). | Small code, large behavioural change |
| **D** | Warn + reason | Allow it, but require a short justification, recorded in the audit log. | Medium |
| **E** | Notify the other organiser | Don't warn the creator; tell the *other* event's owner that an overlap was created. | Medium |

## Contradictions with what we've already built
1. **Inconsistent with how we treat rooms.** A room conflict opens a *negotiation*
   (request the slot, the holder decides). A cohort conflict under option C would just
   *block* you. Same class of problem, two opposite philosophies — users will notice.
2. **It contradicts the consent model.** The whole request-release design says
   "the human who holds it decides." A hard block removes the human entirely.
3. **It trusts data that may be wrong.** An incomplete roster produces a *false all-clear* —
   worse than no check at all, because people stop double-checking once they trust it.
4. **Legitimate double-booking exists.** Optional sessions, split batches, make-up
   classes, guest lectures. A hard rule forbids things faculty genuinely need to do.

## Political & social issues
1. **Whose class wins?** With first-come-first-served, the rule we encode is *"whoever
   books fastest owns the cohort's time."* That may directly contradict the real
   academic order — a core course should probably outrank an elective, and a senior
   colleague may expect precedence. The software silently takes a position on this.
2. **"The system won't let me" replaces a conversation.** Blocking gives people a way
   to avoid negotiating with a colleague. Convenient — but a department runs on those
   conversations, and removing them can harden into resentment.
3. **Whoever maintains the roster becomes a gatekeeper.** If bad roster data blocks a
   professor's class, they are answerable for someone else's data-entry error. That is
   an uncomfortable amount of power for an administrative task.
4. **An override turns admins into schedulers.** If admins can bypass the block,
   everyone queues at the admin's door, and the admin acquires an authority over
   teaching schedules that they may not want and were never given.
5. **Rostering can feel like surveillance.** Recording which students are in which
   cohort, and tracking their conflicts, may be read as monitoring — of students, and
   of faculty whose teaching is now visible and constrained.

## Open questions for the team
- Are we willing to **maintain rosters**? (If no → stop here, keep option A.)
- **Warn or block?** My recommendation is **B (soft warning)** — it restores the
  information without the app overruling a human.
- Should **course type or seniority** affect who "wins"? (If yes, we must encode a
  hierarchy — a much bigger decision.)
- Who may **override**, and is the override visible to the other party?

---

# 2. Requesting a slot without creating an event first

**Status:** not built. Today, the only way to request a room is to *start creating a
clashing event*, at which point a "Request" button appears.

## What it is
You see someone's booking, you want that room/time, so you ask them for it directly —
without inventing an event just to trigger the request.

## Options

| | Option | Notes |
|---|---|---|
| **A** | **"Request this slot" on the event detail** | Lowest friction; matches what people actually try to do (tap the event they want). |
| **B** | Select an occupied slot on the day grid → request | Fits the existing tap-a-slot flow. |
| **C** | A dedicated "find and request a room" screen | Most discoverable, most work. |
| **D** | Keep it as-is (only via the create flow) | Zero work; keeps the "you must have a real event" discipline. |

And orthogonally — **what does acceptance actually do?**
- **D1. Release only:** the room becomes free. Simple, but a third party could grab it
  first, so the requester may negotiate and still lose.
- **D2. Transfer:** the room is handed to the requester. Fair to the requester, but the
  app has now created a booking for an event with no title, kind or cohort.
- **D3. Release + short hold:** freed, but reserved for the requester for N minutes so
  they can complete the details. More code, but it's the behaviour people expect.

## Contradictions with what we've already built
1. **"Release" and "transfer" are not the same thing, and today's design assumes a
   proposal.** The existing release request carries a `proposed_event`. Strip that out
   and acceptance becomes ambiguous — see D1/D2/D3 above. This must be decided
   explicitly or it will be decided accidentally by whoever writes the code.
2. **It bypasses the create flow's validation.** Creating an event requires a title, a
   venue, a valid time. A bare request skips all of that and can still result in a
   booking — producing records the rest of the app assumes are complete.
3. **Races.** Two people request the same slot; the holder accepts both. Who gets it?
   Today nothing prevents this because requests always carried their own event.

## Political & social issues
1. **Power asymmetry becomes one tap.** A request from a senior colleague is hard to
   refuse. Making requests frictionless increases the volume of social pressure on
   whoever holds a desirable room. Convenience for the asker is cost for the holder.
2. **Refusal becomes a record.** Declining is now an explicit, logged act rather than a
   quiet corridor conversation. *"You declined my request"* is evidence, and in a small
   department that can sour a relationship.
3. **Persistence / nagging.** Nothing stops someone requesting the same slot every day.
   We likely need a cool-down, or a "don't ask again for this booking".
4. **Silence is a decision, and we choose what it means.** If the holder never
   responds: auto-expire (the requester loses by default), auto-approve after N days
   (the holder loses by inattention), or escalate to an admin (the admin becomes the
   arbiter). **Every option takes someone's side** — there is no neutral default.
5. **Who may ask whom?** Should any signed-in member be able to request a professor's
   room? Should viewers/students? An unrestricted "ask anyone" can turn into a firehose
   aimed at whoever teaches in the nicest room.

## Open questions for the team
- **Release, transfer, or hold** on acceptance? (This is the decision that matters most.)
- Is there a **response deadline**, and what happens on silence?
- **Rate limit** per person per booking?
- Any **role restrictions** on who may request?

---

# 3. Reassigning someone's booking without their consent

**Status:** not built. Raised earlier in the project; recorded here because it's the
same territory.

## Options
- **A.** Never — all changes go through the request-release flow.
- **B.** Admin-only, with a **mandatory reason** and an automatic notification to the holder.
- **C.** Only for **pending/unconfirmed** bookings (nothing confirmed is ever moved).
- **D.** Emergency override, heavily audited, reviewed afterwards.

## Contradictions
Directly contradicts the consent model that the entire request-release feature exists
to embody. If an admin can simply move a booking, the polite path becomes optional —
and people will route around it.

## Political issues
- An admin moving a professor's booking is a **visible exercise of power**. Even when
  well-intentioned (exam clash, VIP visit), it can read as disrespect if unexplained.
- It creates a **two-tier system**: ordinary users negotiate, admins simply act.
- Without a mandatory reason, the audit log records *what* happened but not *why* —
  which is exactly what's needed when someone objects later.

**Recommendation:** B or C. Never A-in-practice-but-possible-in-code — if the ability
exists, it will eventually be used casually.

---

# Parking lot — ideas not yet analysed

Raised, worth doing, no political dimension identified yet:

- **Free-room finder** — "which rooms are free Thursday 2–4pm?" (backend endpoints
  `/availability/free-slots` already exist and are unused)
- **Bulk calendar export / subscribe feed** — get the whole timetable into your own
  calendar, not one event at a time
- **Search** — find an event by name
- **RSVP / attendance** — participants exist in the data model with no interface
- **Notify a whole cohort** — complicated by roster people not necessarily having logins
- **History view** — the audit log is recorded but never shown

---

# Decision log

Record decisions here so we don't relitigate them.

| Date | Topic | Decision | Rationale |
|---|---|---|---|
| 2026-06-18 | Student clash | Disabled (`STUDENT_CLASH_ENABLED = False`) | Removed at the department's request; venue clash retained |
| 2026-07-20 | Groups | Show cohorts on the event detail + filter the calendar by cohort | Gives groups a purpose without requiring roster data |
| | | | |

_Living document — keep appending. Last updated 2026-07-20._
