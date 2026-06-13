# App-Dev Course ↔ RSP Codebase — Concept Map

> **Purpose.** Connects the topics from your App Development course (Weeks 1–5) to the
> *actual code* in this project, so the course stops being abstract. For each course
> concept you get: **where it appears in our code** and **a resource to learn it deeper**.
>
> **⚠️ One important translation.** Your course teaches the frontend in **Vue**. This
> project's frontend is **React + Vite**. The *concepts* (declarative rendering,
> reactivity, state, directives, API calls) are the same — only the syntax differs. So in
> the Vue week (Week 4) especially, I map each Vue idea to its **React equivalent in our
> code**. Learning both views of the same idea will make you stronger, not confused.
>
> **Scope note.** These 5 weeks are frontend/JavaScript-focused, so most mappings point at
> `frontend/`. The Python/FastAPI backend isn't on this syllabus — concepts it
> demonstrates are collected under "Bonus" at the end for when your course gets there.
>
> **Living document.** I extend this as we build each phase, tagging new code with the
> course concept it demonstrates. See the changelog at the bottom.
>
> _Last updated: foundations pass (before Phase 0)._

---

## Week 1 — JavaScript basics & the web app model

| Course topic | Where it lives in RSP | Notes |
|---|---|---|
| **The web app model** (browser ↔ server) | `frontend/` is the browser app; `backend/` is the server. They talk over HTTP/JSON. | This client/server split *is* our whole architecture — see Week 5. |
| **JS in the browser & Node.js** | All of `frontend/src/*.jsx` runs in the browser. `npm run dev` / Vite run on **Node.js**. | Same language, two runtimes. |
| **Variables: `let` / `const` / `var`** | `const api = axios.create(...)` in [`lib/api.js`](../frontend/src/lib/api.js); `const { token } = useAuthStore()` everywhere. | Modern code: `const` by default, `let` when reassigning, never `var`. |
| **Data types, strings, `null`/`undefined`** | `localStorage.getItem('token')` returns a string or `null`; the store guards with `try/catch`. | See [`store/authStore.js`](../frontend/src/store/authStore.js). |
| **Operators & comparisons** | `err.response?.status === 401` in `api.js` — strict equality + **optional chaining** (`?.`). | `===` not `==`. `?.` avoids "cannot read property of undefined" crashes. |
| **Functions & arrow / anonymous functions** | The Axios interceptors are anonymous arrow functions: `api.interceptors.request.use((config) => {...})`. | Arrow functions are everywhere in React event handlers. |
| **Basic DOM usage** | We rarely touch the DOM directly — React does it for us. The one direct mount point is `createRoot(document.getElementById('root'))` in `frontend/src/main.jsx`. | Contrast: the course manipulates the DOM by hand; React is the *declarative* alternative (Week 3–4). |

**Learn more:** [MDN JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide) · [javascript.info – The JavaScript language](https://javascript.info/js) · [How the web works (MDN)](https://developer.mozilla.org/en-US/docs/Learn/Getting_started_with_the_web/How_the_Web_works)

---

## Week 2 — Collections, objects, modules & async basics

| Course topic | Where it lives in RSP | Notes |
|---|---|---|
| **Arrays + `map` / `filter` / `find`** | Rendering lists: events `.map(...)` into cards in `DashboardPage.jsx`; filtering rooms by type in `ResourcesPage.jsx`. | `.map()` to turn data into UI is the single most common React pattern. |
| **Destructuring** | `const { user, token } = useAuthStore()`; props destructured in component signatures. | Pulls fields out of objects/arrays in one line. |
| **Modules: `import` / `export`, ES6 modules, npm** | Every `.jsx` file: `import { api } from '../lib/api'` / `export default function Page() {}`. Dependencies installed via **npm** (`package.json`). | Vite uses native ES6 modules. |
| **Objects, methods, `Object.keys/values/entries`** | Config/lookup objects like `TYPE_LABEL` in `ResourcesPage.jsx`; payload objects sent to the API. | |
| **JSON: `JSON.stringify` / `JSON.parse`** | `JSON.parse(localStorage.getItem('user'))` on store init; the API speaks JSON end-to-end. | localStorage only stores strings, so objects must be stringified. |
| **Async basics: event loop, promises, blocking vs non-blocking** | Every API call returns a **Promise**; we `await` it: `const res = await api.post('/events', ...)`. | Network calls must be non-blocking or the UI freezes. This is the heart of Week 5 too. |

**Learn more:** [javascript.info – Promises, async/await](https://javascript.info/async) · [MDN – Working with objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects) · [MDN – Array methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)

---

## Week 3 — Frontend implementation & state

| Course topic | Where it lives in RSP | Notes |
|---|---|---|
| **Frontend responsibilities** (no heavy logic, don't store the source of truth) | Pages render and call the API; the real data + rules live in the backend. | The SPA is a "view" over server state. |
| **HTTP is stateless** | Each request must re-prove who you are. We attach a **JWT** on every request via the interceptor in `lib/api.js`. | The server remembers nothing between requests — the token carries identity. |
| **Application state** | [`store/authStore.js`](../frontend/src/store/authStore.js) (Zustand) holds `user` + `token` app-wide. | This is *application* state — shared across pages. |
| **UI / component state** | The multi-step "Create Event" modal tracks its current step + form fields with React's `useState`. | This is *UI* state — local to one component. |
| **System state** | The data on the server / in Postgres. | The frontend mirrors a slice of it. |
| **Imperative vs declarative** | React JSX is **declarative**: you describe *what* the UI should look like for a given state, not *how* to mutate the DOM. | Same philosophy as Vue (Week 4). |
| **The state-management problem** | Why Zustand exists: keep one source of truth for auth so every page agrees on who's logged in. | The course's tic-tac-toe motivation = our auth store. |

**Learn more:** [React – Thinking in React](https://react.dev/learn/thinking-in-react) · [React – Managing State](https://react.dev/learn/managing-state) · [Zustand docs](https://zustand.docs.pmnd.rs/) · [MDN – Client-side storage](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Client-side_web_APIs/Client-side_storage)

---

## Week 4 — Vue & declarative UI  *(mapped to React, our framework)*

Your course uses **Vue**; we use **React**. Here's the Rosetta Stone — same concept, our code:

| Vue concept (course) | React equivalent | Where in RSP |
|---|---|---|
| **Declarative rendering** (templates) | **JSX** | All `.jsx` files — markup written as expressions. |
| **Reactivity** (`Object.defineProperty` getters/setters) | `useState` + re-render; Zustand store subscriptions | Vue tracks property reads; React re-runs the component when state changes. Different engine, same goal: *UI follows data automatically*. |
| **`v-bind` / `:attr`** (bind attribute to data) | `<Badge label={r.name} />` — curly-brace binding | `ResourcesPage.jsx` |
| **`v-model`** (two-way form binding) | `value={x}` + `onChange={e => setX(e.target.value)}` (controlled inputs) | The Create-Event modal's form fields. |
| **`v-on:click` / `@click`** | `onClick={...}` | Buttons throughout. |
| **`v-if` / `v-show`** (conditional render) | `{condition && <X/>}` or ternary | `{isAdmin && <EditButton/>}` in `ResourcesPage.jsx`. |
| **`v-for`** (list render) | `array.map(item => <X key={...}/>)` | Resource/event/booking lists. |
| **The need for `key`s** ⭐ | React's `key` prop | **Great real example:** the calendar builds composite keys `` `${event.id}__${event.start}` `` for recurring-event blocks, because one recurring event renders many blocks that each need a unique key. See `CalendarPage.jsx`. This is *exactly* the "why keys matter" lesson. |
| **Computed properties** | Derived values / `useMemo` | e.g. filtering/deriving displayed lists from raw data + filter state. |
| **Components, props, slots** | Components, props, `children` | `components/ui/index.jsx` (Card, Badge, Button) are reusable primitives passed props + children. **Phase 1:** `ResourceCard` in `ResourcesPage.jsx` is a fresh extraction — it receives props `r` / `isAdmin` / `onEdit`. |
| **Reuse / DRY** | Same principle | One `CreateEventModal` reused by both Dashboard and Calendar pages. |

**Learn more:** [React docs (start here)](https://react.dev/learn) · [Vue docs](https://vuejs.org/guide/introduction.html) (to match your lectures) · [Vue vs React, concept-by-concept](https://react.dev/learn/thinking-in-react) · [Why React needs keys](https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key)

---

## Week 5 — Using APIs & asynchronous frontend communication

| Course topic | Where it lives in RSP | Notes |
|---|---|---|
| **Separation of frontend/backend via API** | The frontend only talks to the backend through `/api/v1/...` HTTP endpoints. | The cleanest example of the whole course's thesis. |
| **JSON as a neutral data format** | Every request/response body is JSON. | Python on one side, JS on the other, JSON in between. |
| **URL-based APIs** | `api.post('/events', ...)`, `api.get('/resources')`, etc. | The route list is in `CLAUDE.md` → "API structure". |
| **`fetch()` vs Axios** | We use **Axios**: [`lib/api.js`](../frontend/src/lib/api.js) creates one configured instance. | Axios adds interceptors, base URL, and JSON handling over raw `fetch`. |
| **Interceptors / cross-cutting concerns** | Request interceptor injects the JWT; response interceptor catches `401` and redirects to login. | A clean place to handle auth for *every* call at once. |
| **Promises, async/await, the event loop** | `async`/`await` on every call; the store's `login()` awaits the POST then saves the token. | Ties straight back to Week 2's async basics. |
| **Public APIs exist** | We call one external API today: the **Discord webhook** for feedback (`feedback/service.py`). | 🔜 Phase 4 adds **email + ICS calendar invites** — more external-API consumption. |

**Learn more:** [MDN – Fetching data / Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) · [Axios docs](https://axios-http.com/docs/intro) · [javascript.info – Network requests](https://javascript.info/network) · [What is a REST API](https://developer.mozilla.org/en-US/docs/Glossary/REST)

---

## Bonus — concepts the app uses *beyond* the current 5 weeks

These show up in our code and are worth knowing; your course may reach some later.

| Concept | Where | Quick pointer |
|---|---|---|
| **JWT authentication** | `core/security.py`, `lib/api.js` | [jwt.io intro](https://jwt.io/introduction) |
| **REST API design / versioning** (`/api/v1/`) | `backend/app/api/v1/routes/` | [REST best practices](https://restfulapi.net/) |
| **Event-driven architecture / pub-sub** | `core/events.py` (in-process event bus) | [Pub/sub pattern](https://en.wikipedia.org/wiki/Publish%E2%80%93subscribe_pattern) |
| **Finite State Machine** (booking lifecycle) | `bookings/service.py` `VALID_TRANSITIONS` | [FSM (Wikipedia)](https://en.wikipedia.org/wiki/Finite-state_machine) |
| **Rate limiting** | `core/limiter.py` (slowapi) | [Rate limiting explained](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) |
| **Service layer & DRY** (one overlap rule, reused by booking + UI) | `modules/availability/service.py` (Phase 0) | [DRY principle](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) · [Separation of concerns](https://en.wikipedia.org/wiki/Separation_of_concerns) |
| **Everything in `DBMS_FOUNDATIONS.md`** | the database layer | see the sibling doc |

---

## Changelog

- **Foundations pass (pre-Phase 0):** mapped all 5 course weeks to existing code, with the
  Vue→React translation table for Week 4.
- **Phase 0 (backend):** added "Service layer & DRY" to the Bonus table — the new
  `AvailabilityService` is the single source of truth for "is it free?", reused by both
  booking creation and the upcoming room-list UI.
- **Phase 1 (step 1):** room-filter reorder + grouping by type → Week 2 `filter`/`map`,
  Week 4 list rendering, **keys**, and a real component extraction (`ResourceCard`).
- **Phase 1 (steps 3–5):** "Type + number" labels (`roomLabel`); per-date status dots that
  fetch `/availability/day` (`useState` + `useEffect([date])`); empty-room search + "only
  free" toggle (combined `filter` + `includes`) → Weeks 2, 3, 5.
- **Phase 2:** Groups/roster management page + group-targeting & a live clash preview in the
  create-event modal → Week 3 (state: `selectedGroups`, `clashes`), Week 4 (checkbox lists,
  conditional rendering), Week 5 (`POST /clashes/preview`). Backend introduced the SQL **JOIN**
  and **set intersection** for student clashes (see `DBMS_FOUNDATIONS.md` §5).
- **Phase 3:** Request-Release dashboard (incoming/outgoing) + "Request this slot" on bookings →
  Week 5 (POST accept/decline/cancel), Week 3/4 (state + lists + conditional buttons). Backend is
  a small **finite state machine** (requested → accepted_released / declined / cancelled); one-tap
  accept frees the slot by cancelling the holder's booking.
- **Phase 4:** `EmailService` subscribes to the same event bus as in-app notifications →
  **pub/sub fan-out** (one domain event → multiple channels). Hand-rolled `.ics` invite
  (RFC 5545), SMTP via Python's stdlib `smtplib`, no-op-safe when unconfigured. Bonus concepts:
  event-driven side effects, the iCalendar format.
- **Phase 5:** `events.category` enum (academic vs ad-hoc) + a free-slot finder UI on the
  Resources page (reuses the Phase 0 `/availability/free-slots` engine) + a category select in
  the create modal → Week 5 (API), Week 3/4 (state, conditional rendering, modals).
- _next:_ as we build, each phase tags its new code with the course concept it demonstrates
  (e.g. Phase 1's room-list UI → Week 2 `map`/`filter` + Week 4 list rendering & keys;
  Phase 3's Request-Release dashboard → Week 3 state + Week 5 API calls).
