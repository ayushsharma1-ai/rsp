# Truthy/Falsy & the `||` `&&` `?.` operators — studied against the RSP frontend

> **Who this is for:** you — continuing Stage 1 after [`JS_OBJECTS.md`](JS_OBJECTS.md) and
> [`JS_ARRAYS.md`](JS_ARRAYS.md).
> **Goal:** understand *truthy/falsy* and the three little operators built on it
> (`||`, `&&`, `?.`) — the "Truthy/falsy + shortcuts" row of
> [`FRONTEND_STUDY_PATH.md`](FRONTEND_STUDY_PATH.md) Stage 1. These appear on almost every line
> of React.
> **Sample used throughout:**
> ```js
> const user = { name: 'Alice', role: 'admin' }
> const room = { name: 'A101', description: '' }   // empty description, NO capacity key
> ```
>
> _Last updated: truthy/operators pass (2026-06-12)._

---

## Idea 1 — truthy & falsy

JS often needs a **yes/no** answer (inside `if`, or `filter`). The quirk: you can hand it **any
value**, and it decides *"does this count as yes or no?"*

**The falsy values (count as NO) — memorize this short list:**

```
false        the actual false
0            the number zero
''           an empty string
null         "deliberately nothing"
undefined    "missing" (a missing object key gives this)
NaN          "not a number" (a broken calculation)
```

**Everything else is truthy (counts as YES)** — any non-zero number, any non-empty string, any
object, any array (even `[]`!).

```js
if (user)             // YES — an object
if (room.name)        // YES — 'A101'
if (room.description) // NO  — '' (empty string)
if (room.capacity)    // NO  — missing key → undefined → falsy
if (30)               // YES   if (0)   // NO
```

> The `filter` gotcha this explains: `rooms.filter(r => r.seats)` keeps **everything**, because
> every `seats` value (30, 60, 20) is a non-zero number → truthy. You need a real test:
> `r.seats > 25`.

---

## Idea 2 — `||` ("use this, or fall back to that")

**Use the left; if the left is falsy, use the right.** The **default/fallback** tool.

```js
const cap = room.capacity || 'unknown'
// room.capacity is undefined → falsy → fall back → 'unknown'
// if it were 30 → truthy → use it → 30
```

**In our code:**
```js
(r.name || '').trim()                          // ResourcesPage:13  missing name → '' so .trim() is safe
TYPE_LABEL[r.resource_type] || r.resource_type  // ResourcesPage:11  no label found → show the raw code
```

---

## Idea 3 — `&&` ("only if this exists, then that")

**If the left is truthy, give the right; otherwise stop.** In React: *"only show this if it
exists."*

```js
room.description && `Note: ${room.description}`
// description is '' → falsy → stop → nothing
// 'Main lab'        → truthy → 'Note: Main lab'
```

**In our code:**
```js
{r.description && <p className="resource-card__desc">{r.description}</p>}   // ResourcesPage:150
// no description → render nothing; has one → render the paragraph
```

---

## Idea 4 — `?.` ("reach in safely, don't crash")

**Optional chaining.** Read `a?.b`; if `a` is `null`/`undefined`, the whole thing is `undefined`
instead of crashing.

```js
user?.role          // user exists → 'admin'
// if user were null:
user.role           // ❌ CRASH: "cannot read property 'role' of null"
user?.role          // ✅ undefined, no crash
```

**In our code:**
```js
user?.role === 'admin'           // ResourcesPage:31  user may be null while logging in
availability[r.id]?.is_free      // ResourcesPage:54  that room may not be in the map yet
err.response?.data?.detail       // ResourcesPage:245 chain several safe reads
```

> Often paired with `||` for a safe read *plus* a default:
> `user?.role || 'guest'` → role if present, else `'guest'`.

---

## The three in one breath

```
a || b     →  use a, fall back to b if a is empty/missing     (default)
a && b     →  only give b if a exists                          (only-if / conditional render)
a?.b       →  read a.b safely; undefined if a is missing       (no crash)
```

All three lean on the **truthy/falsy** idea from Idea 1.

---

## Drills (answers below)

Using `user = { name:'Alice', role:'admin' }` and `room = { name:'A101', description:'' }`:

1. `room.capacity || 'n/a'` → ?
2. `room.description || 'no description'` → ?  (careful — what *kind* of value is `''`?)
3. `room.name && 'has a name'` → ?
4. With `let user = null;` what is `user?.name`? And what would `user.name` do?
5. Which of these are falsy: `0`, `'0'`, `[]`, `''`, `undefined`?

<details><summary>Answers</summary>

1. `'n/a'` — `capacity` is missing → undefined → falsy → fallback.
2. `'no description'` — `''` is **falsy**, so it falls back. (A common surprise: empty string counts as "nothing".)
3. `'has a name'` — `'A101'` is truthy, so `&&` gives the right side.
4. `user?.name` → `undefined` (safe). `user.name` → **crashes** ("cannot read property of null").
5. Falsy: `0`, `''`, `undefined`. **Truthy:** `'0'` (non-empty string!), `[]` (an array is always truthy).
</details>

---

**Learn more:** [MDN — Falsy](https://developer.mozilla.org/en-US/docs/Glossary/Falsy) ·
[MDN — Optional chaining `?.`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Optional_chaining) ·
[javascript.info — Logical operators](https://javascript.info/logical-operators)

---

## Changelog
- **2026-06-12** — Created during the truthy/operators session. Grounded in `ResourcesPage.jsx`.
