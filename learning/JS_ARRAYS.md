# JavaScript Arrays & `map`/`filter`/`find` — studied against the RSP frontend

> **Who this is for:** you — comfortable with Python/Java, fresh off [`JS_OBJECTS.md`](JS_OBJECTS.md).
> **Goal:** master arrays and their core methods — the second half of
> [`FRONTEND_STUDY_PATH.md`](FRONTEND_STUDY_PATH.md) Stage 1 — by reading them in our real code
> ([`ResourcesPage.jsx`](../frontend/src/pages/ResourcesPage.jsx),
> [`BookingsPage.jsx`](../frontend/src/pages/BookingsPage.jsx),
> [`CalendarPage.jsx`](../frontend/src/pages/CalendarPage.jsx)).
> **How to use:** read **Part 1** for the map, then **Part 2** (the big mental shift +
> the core four methods) and **Part 3** (arrays-of-objects → UI, the pattern that *is* React).
> Builds directly on the **reference + spread** rules from `JS_OBJECTS.md` Part 3.
> Pairs with [`COURSE_CONCEPTS.md`](COURSE_CONCEPTS.md) Week 2.
>
> _Last updated: arrays foundations pass (2026-06-12)._

---

## You already know (lean on this)

A JS **array** is an ordered list — basically a **Python list** (`[1, 2, 3]`) or a Java
`ArrayList`. Same brackets, zero-based indexing, `.length` for size.

```js
const TYPES = ['classroom', 'lab', 'computer_room']   // ResourcesPage:7
TYPES[0]        // 'classroom'   (index, zero-based)
TYPES.length    // 3
```

The new habit to build: in modern JS you **rarely write `for` loops**. You call **methods that
take a function** (`map`, `filter`, `find`, …). That shift is 90% of this topic.

---

## Part 1 — The whole topic at a glance

| Method | Returns | Use it to… | In our code |
|---|---|---|---|
| **`map`** | a **new array, same length** | transform every item | `TYPES.map(t => <button>…)` ([ResourcesPage:86](../frontend/src/pages/ResourcesPage.jsx)) |
| **`filter`** | a **new, shorter array** | keep items that pass a test | `resources.filter(r => …)` ([ResourcesPage:52](../frontend/src/pages/ResourcesPage.jsx)) |
| **`find`** | **one item** (or `undefined`) | get the first match | `localEvts.find(ev => ev.key === key)` ([CalendarPage:175](../frontend/src/pages/CalendarPage.jsx)) |
| **`forEach`** | **nothing** (`undefined`) | do a side-effect per item | (we mostly use `for…of` instead) |
| **`some`** | **boolean** | "does *any* item pass?" | `clashes.some(c => c.student_clash)` ([BookingsPage:247](../frontend/src/pages/BookingsPage.jsx)) |
| **`every`** | **boolean** | "do *all* items pass?" | — |
| **`includes`** | **boolean** | "is this value in the list?" | `['pending','confirmed','approved'].includes(row.status)` ([BookingsPage:91](../frontend/src/pages/BookingsPage.jsx)) |
| **`push`** | mutates (adds to end) | build a list imperatively | `TIME_SLOTS.push({…})` ([BookingsPage:17](../frontend/src/pages/BookingsPage.jsx)) |
| **`split`** | string → array | break a string up | `full_name.split(' ')[0]` ([AppLayout:102](../frontend/src/components/layout/AppLayout.jsx)) |

**The mental split:** `map`/`filter` give you a **new array** (transform/select), `find`/`some`/
`every`/`includes` give you **one answer** (a match or a boolean), `forEach`/`for…of` are for
**side-effects** (do something, return nothing).

---

## Part 2 — The mental shift + the core four

### Old way vs JS way

```js
// imperative (what you'd write in many languages):
const labels = []
for (let i = 0; i < TYPES.length; i++) {
  labels.push(TYPE_LABEL[TYPES[i]])
}

// JS way — describe the transform, no manual loop/index:
const labels = TYPES.map(t => TYPE_LABEL[t])
```

You hand `map` a **function**, and it runs that function on each item for you. The function is
usually an **arrow function** (`t => …`). That's the pattern under all four methods.

### The callback gets `(item, index)`

Every callback receives the **item** first and its **index** second:

```js
slots.map((s, i) => <li key={i}>{hhmm(s.start)} – {hhmm(s.end)}</li>)   // ResourcesPage:206
//         └item └index
```

You only name `index` when you need it (often for React's `key`, below).

### `map` — transform every item → new array of the same length

The #1 React pattern: turn a **data array into a UI array**.

```js
{TYPES.map(t => (
  <button key={t} onClick={() => setFilter(t)}>{TYPE_LABEL[t]}</button>
))}                                                        // ResourcesPage:86
```

`map` can also transform data into new **objects** (note this reuses spread from `JS_OBJECTS`):

```js
const withKeys = r.data.map(evt => ({ ...evt, key: makeKey(evt) }))   // CalendarPage:72
// each event → a copy of that event plus a new `key` field
```

### `filter` — keep the items that pass a test → new, shorter array

The callback returns **`true` (keep)** or **`false` (drop)**:

```js
const filtered = resources.filter(r => {
  if (filter && r.resource_type !== filter) return false   // drop wrong type
  if (onlyFree && !availability[r.id]?.is_free) return false
  return true                                              // keep
})                                                          // ResourcesPage:52
```

Simpler ones:
```js
TIME_SLOTS.filter(s => s.value > form.start_time)          // BookingsPage:273
```

### `find` — the first matching item, or `undefined`

`filter` gives you *all* matches (an array); `find` gives you the *first* match (one item):

```js
const evt = localEvts.find(ev => ev.key === key)           // CalendarPage:175
// → that one event object, or undefined if none matched
```

Because it can return `undefined`, read its result safely (`evt?.something`) — straight from the
objects lesson.

### `forEach` vs `for…of` — side-effects, return nothing

`forEach` runs a function per item but **gives nothing back** — use it only for side-effects, not
to build a value. In our code we actually prefer **`for…of`** for that, e.g. building a lookup:

```js
for (const item of r.data) {       // ResourcesPage:46
  map[item.id] = item              // side-effect: fill the `map` object
}
```

> Rule of thumb: need a **new array**? → `map`/`filter`. Need **one match/boolean**? →
> `find`/`some`/`includes`. Just **doing something** per item? → `for…of` (or `forEach`).

### `some` / `every` / `includes` — quick boolean checks

```js
clashes.some(c => c.student_clash)                          // BookingsPage:247  any clash?
days.some(d => isSameDay(d, today))                         // CalendarPage:455  is today in view?
['pending','confirmed','approved'].includes(row.status)     // BookingsPage:91   status in this set?
```

`includes` checks a **plain value**; `some`/`every` check with a **function** (any / all).

### Chaining — filter then map

Because `filter` returns an array, you can immediately `map` it. You'll see this constantly:

```js
resources.filter(r => r.resource_type === t).map(r => <ResourceCard r={r} … />)
// keep this type, then turn each survivor into a card
```

---

## Part 3 — Arrays of objects → UI (the pattern that *is* React)

Almost every array in this app is an **array of objects** (the API returns a list of records).
So objects + arrays combine: you `filter`/`find` by reading fields with **dot/bracket**, and
`map` each object into a component.

```js
group.map(r => (
  <ResourceCard key={r.id} r={r} availability={availability[r.id]} … />
))                                                          // ResourcesPage:107
```

### React keys — why every mapped element needs `key={…}`

When you `map` an array into elements, React asks for a unique **`key`** per item so it can tell
them apart across re-renders (to update the right one, not redraw all). Use a **stable id**:

```js
{group.map(r => <ResourceCard key={r.id} … />)}    // ✅ stable id
{slots.map((s, i) => <li key={i}>…</li>)}          // ⚠️ index — ok only for static lists
```

> Prefer `key={item.id}`. A `key={index}` is acceptable for lists that never reorder/insert,
> but causes subtle bugs when they do. (Full treatment is Stage 4 — just always add a `key`.)

### Map-with-destructuring (arrays + objects + destructuring together)

You can destructure each item right in the callback's parameter list:

```js
{NAV.map(({ to, icon: Icon, label }) => (            // AppLayout:52
  <NavLink to={to}>{<Icon/>} {label}</NavLink>
))}
// NAV is an array of objects; we pull `to`, `icon` (renamed Icon), `label` out of each
```

---

## Part 4 — Immutability (the reference rule, again)

From `JS_OBJECTS.md` Part 3: **arrays are objects too**, so `b = arr` *shares*, and React only
re-renders when it sees a **new** array. Good news: **`map` and `filter` already return brand-new
arrays** — they never touch the original. That's exactly why React state updates use them:

```js
setLocalEvts(prev => prev.map(ev =>                  // CalendarPage:166
  ev.key === key ? { ...ev, start: newStart } : ev   // replace one, copy the rest
))
// new array (from map), with one new object (from spread) — everything else reused
```

Methods to know by whether they mutate:

| Returns a **new** array (safe for state) | **Mutates** in place (avoid on state) |
|---|---|
| `map`, `filter`, `slice`, `concat`, `[...arr]` | `push`, `pop`, `splice`, `sort`, `reverse` |

To add to a state array immutably, **don't `push`** — spread into a new one:
```js
setItems(prev => [...prev, newItem])      // ✅ new array
// items.push(newItem)                     // ❌ mutates the shared array → no re-render
```

(`push` is fine for a *local* array you're building from scratch, like `TIME_SLOTS` at
[BookingsPage:17](../frontend/src/pages/BookingsPage.jsx) — that one isn't React state.)

---

## Quick reference

```js
arr[0]; arr.length                     // index & size
arr.map(x => f(x))                     // transform → new array (same length)
arr.filter(x => test(x))               // keep matches → new shorter array
arr.find(x => test(x))                 // first match or undefined
arr.some(x => test(x))                 // any match? → boolean
arr.every(x => test(x))                // all match? → boolean
arr.includes(value)                    // is value present? → boolean
arr.filter(...).map(...)               // chain: select then transform
[...arr, item]                         // add immutably (new array)
str.split(' '); parts.join('-')        // string ↔ array
for (const x of arr) { /* side-effect */ }   // when you're not building a value
```

**Browser experiment** (F12 → Console):
```js
const rooms = [{id:1,type:'lab'},{id:2,type:'classroom'},{id:3,type:'lab'}]
rooms.map(r => r.type)                  // ['lab','classroom','lab']
rooms.filter(r => r.type === 'lab')     // two objects
rooms.find(r => r.id === 2)             // {id:2,type:'classroom'}
rooms.some(r => r.type === 'lab')       // true
const more = [...rooms, {id:4,type:'equipment'}]   // new array, rooms untouched
rooms.length                            // still 3
```

**Learn more:** [MDN — Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array) ·
[javascript.info — Array methods](https://javascript.info/array-methods) ·
[react.dev — Rendering Lists](https://react.dev/learn/rendering-lists) (keys)

---

## Changelog
- **2026-06-12** — Created during arrays study session. Core four methods + arrays-of-objects→UI
  + keys + immutability, grounded in `ResourcesPage`, `BookingsPage`, `CalendarPage`, `AppLayout`.
