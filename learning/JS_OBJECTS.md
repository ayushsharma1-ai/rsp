# JavaScript Objects — studied against the RSP frontend

> **Who this is for:** you — comfortable with Python/Java/OOP, new to JS.
> **Goal:** master JS objects, the very first row of [`FRONTEND_STUDY_PATH.md`](FRONTEND_STUDY_PATH.md)
> Stage 1, by reading them in *our actual app* (mostly [`ResourcesPage.jsx`](../frontend/src/pages/ResourcesPage.jsx)
> and [`authStore.js`](../frontend/src/store/authStore.js)).
> **How to use:** read **Part 1** as a reference (the whole topic at a glance), then study
> **Part 2** and **Part 3** — the two ideas beginners trip on most (*dot vs bracket*, and
> *references + spread*). Do the drills at the end of each.
> Pairs with [`COURSE_CONCEPTS.md`](COURSE_CONCEPTS.md) Week 2 (objects, JSON, destructuring).
>
> _Last updated: objects foundations pass (2026-06-12)._

---

## You already know (lean on this)

In Python you have **dicts** for key→value bags and **classes/objects** for records-with-methods.
In Java you have **objects** for records and **`HashMap`** for lookups. **JavaScript merges all
of that into one thing — the object.** Same `{ }`, two roles: sometimes a dict, sometimes a record.

```js
const r = { name: 'A101', capacity: 30, is_active: true }
//          └ key   └ value
```

---

## Part 1 — The whole topic at a glance

| Idea | Looks like | In our code | One-liner |
|---|---|---|---|
| **Make one** | `{ key: value }` | `TYPE_LABEL = { classroom: 'Classroom', ... }` ([ResourcesPage:8](../frontend/src/pages/ResourcesPage.jsx)) | a bag of key→value pairs |
| **Read — dot** | `r.name` | `r.capacity`, `r.id` | when you *know* the key name |
| **Read — bracket** | `obj[expr]` | `TYPE_LABEL[r.resource_type]`, `availability[r.id]` ([:11](../frontend/src/pages/ResourcesPage.jsx),[:54](../frontend/src/pages/ResourcesPage.jsx)) | when the key is in a **variable** |
| **Two roles** | lookup vs record | `TYPE_LABEL` (lookup) vs `r` (record) | same syntax, different use |
| **Missing key** | `→ undefined` | `r.description` when absent | **no crash** (unlike Python `KeyError`) |
| **Safe read** | `a?.b` | `user?.role`, `availability[r.id]?.is_free` ([:31](../frontend/src/pages/ResourcesPage.jsx)) | don't crash if left side is missing |
| **Fallback** | `a \|\| b` | `(r.name \|\| '').trim()` ([:13](../frontend/src/pages/ResourcesPage.jsx)) | use `b` if `a` is missing/falsy |
| **Nested** | `o.a.b` | `availability[r.id]?.is_free` | objects hold objects |
| **Change in place** | `o.k = v` | `map[item.id] = item` ([:47](../frontend/src/pages/ResourcesPage.jsx)) | objects are mutable |
| **Copy + change** | `{ ...o, k: v }` | `setForm(f => ({ ...f, [k]: v }))` ([:229](../frontend/src/pages/ResourcesPage.jsx)) | **the React idiom** (Part 3) |
| **Destructure** | `const { x } = o` | `const { user } = useAuthStore()` ([:20](../frontend/src/pages/ResourcesPage.jsx)) | pull fields into variables |
| **Reference** | `b = a` shares | (Part 3) | a variable holds a *pointer*, not a copy |
| **JSON** | `parse` / `stringify` | `JSON.parse(localStorage.getItem('user'))` ([authStore:6](../frontend/src/store/authStore.js)) | text ↔ object |
| **Methods** | `{ f: () => {} }` | store's `login`, `logout` ([authStore:10](../frontend/src/store/authStore.js)) | a value can be a function |

**Key facts that surprise Python people:**
- A missing key returns **`undefined`**, it does **not** raise — hence all the `?.` and `|| fallback`.
- Object keys are **strings** even when written bare: `{ classroom: ... }`'s key is `"classroom"`.
- `b = a` does **not** copy an object — both names point at the *same* object (Part 3).

---

## Part 2 — Deep dive #1: dot vs bracket

This is the #1 beginner stumble. Get this and half of "reading data" is solved.

### The one rule

> **Dot uses the key you literally type. Bracket uses the key a *value* evaluates to.**

```js
r.name              // the key literally called  name
r[something]        // the key whose name is whatever `something` holds right now
```

### The hidden truth: dot is just shorthand for bracket-with-a-string

These two lines are **identical**:

```js
r.name
r["name"]           // exactly the same thing
```

So `obj.x` literally *means* `obj["x"]`. Dot is a convenience for the common case where the
key is a fixed, valid name. Bracket is the general form. Once you see that, the rule becomes
obvious: **if the key is a plain literal name, dot works; for anything else, you need bracket.**

### Why bracket is sometimes *required* — trace the substitution

Look at line [11](../frontend/src/pages/ResourcesPage.jsx): `TYPE_LABEL[r.resource_type]`. Watch it resolve in steps:

```js
// say  r = { resource_type: 'lab', ... }

TYPE_LABEL[r.resource_type]
TYPE_LABEL[ 'lab' ]          // step 1: r.resource_type is the VALUE 'lab'
'Lab'                        // step 2: look up key "lab" in TYPE_LABEL
```

The key (`'lab'`) wasn't known when you typed the code — it came out of `r`. **That's exactly
when you must use brackets.** You literally cannot write this with a dot.

### The classic bug: dot can't do dynamic keys

```js
const key = 'capacity'

r[key]        // ✅ → r['capacity'] → 30      (uses the VALUE of key)
r.key         // ❌ → r['key'] → undefined    (looks for a literal key named "key")
```

`r.key` does **not** mean "the key stored in the variable `key`." It means the literal key
`"key"`, which doesn't exist → `undefined`. **With quotes vs a variable also differ:**

```js
TYPE_LABEL['resource_type']   // literal key "resource_type" → undefined (no such key)
TYPE_LABEL[r.resource_type]   // the VALUE of r.resource_type, e.g. "lab" → 'Lab'
```

### Three more things only bracket can do

```js
obj['has space']     // keys that aren't valid names
obj['123']           // keys that start with a digit
obj[someVariable]    // keys decided at runtime  ← the big one
```

(Numbers as keys get turned into strings: `obj[1]` is really `obj["1"]`.)

### Computed keys when *writing*, not just reading

The same "key from a value" idea works when you **build or set** keys:

```js
// setting a key whose name comes from a variable:
map[item.id] = item                 // ([:47]) → adds key  <that id> : item

// building an object with a dynamic key — note the [ ] around the key:
setForm(f => ({ ...f, [k]: v }))    // ([:229]) → sets key  <value of k> : v
```

In `{ [k]: v }` the brackets mean *"the key is the value of `k`"* — same rule, writing side.
Without the brackets, `{ k: v }` would make a literal key named `"k"`.

### Decision guide

```
Do you know the exact key name as you type the code, and is it a normal name?
  ├─ yes →  use DOT      r.name
  └─ no  →  use BRACKET  obj[expr]
            (key is in a variable, has spaces/digits, or is computed)
```

### Drills (answers below)

Given `r = { resource_type: 'lab', name: 'A101' }` and `TYPE_LABEL = { lab: 'Lab' }`:

1. What does `r.resource_type` give? And `r['resource_type']`?
2. What does `TYPE_LABEL[r.resource_type]` give? Walk the two steps.
3. `const f = 'name'; ` — write the access that returns `'A101'` using `f`.
4. Why does `TYPE_LABEL.r.resource_type` not work?
5. In `{ [k]: v }`, if `k = 'capacity'` and `v = 30`, what object is built?

<details><summary>Answers</summary>

1. Both give `'lab'` — `r.resource_type` and `r['resource_type']` are identical.
2. `r.resource_type` → `'lab'`, then `TYPE_LABEL['lab']` → `'Lab'`.
3. `r[f]` → `r['name']` → `'A101'`. (`r.f` would be `undefined`.)
4. It reads literal key `r` on `TYPE_LABEL` (→ `undefined`), then `.resource_type` on that → crash. The key you want is *inside* `r`, so you need `TYPE_LABEL[r.resource_type]`.
5. `{ capacity: 30 }`.
</details>

---

## Part 3 — Deep dive #2: references + spread (the React-critical one)

This is the #2 beginner stumble, and it's the reason React code copies objects everywhere.

### Primitives copy by value; objects copy by reference

```js
let a = 5
let b = a
b = 99
a            // → 5    (numbers are copied — independent)

let o = { x: 1 }
let p = o
p.x = 99
o.x          // → 99   (objects are SHARED — same object!)
```

A variable holding an object doesn't *contain* the object — it holds a **pointer** to it.
`p = o` copies the *pointer*, so both names point at one object:

```
   o ─────┐
          ▼
       ┌──────────┐
       │ { x: 99 }│   ← ONE object, two names aimed at it
       └──────────┘
   p ─────┘
```

> Python/Java parallel: identical to `b = a` on a Python dict, or assigning a Java object
> reference. So you already know this — JS just behaves the same way. The new part is the
> **spread** tool below and **why React forces you to use it.**

### `===` on objects compares identity, not contents (surprising!)

```js
{ x: 1 } === { x: 1 }     // → false  (!!) two different objects
const o = { x: 1 }
o === o                   // → true   (same object)
```

`===` asks *"are these the very same object?"*, **not** *"do they look alike?"* This single
fact is the engine behind the next point.

### Why React makes you create a *new* object

React decides whether to re-draw by checking `oldState === newState`. If you **mutate** the
existing object, it's still the same object (`===` is `true`) → React thinks nothing changed →
**the screen won't update.** So you must hand it a **new** object. That's what spread does.

```js
// ❌ mutation — same object, React may not re-render:
form.capacity = 50
setForm(form)

// ✅ new object — React sees a change and re-renders:
setForm({ ...form, capacity: 50 })
```

Your real code, line [229](../frontend/src/pages/ResourcesPage.jsx):
```js
setForm(f => ({ ...f, [k]: v }))   // new object = (all of f) + (key k set to v)
```
Read `{ ...f, [k]: v }` as **"a fresh object, copy every key from `f`, then override key `k`."**
The `...f` is the copy; `[k]: v` is the computed-key override (Part 2).

More real uses:
```js
{ ...form, capacity: form.capacity ? Number(form.capacity) : null }   // [:237] copy + fix one field
{ name:'', description:'', ..., ...(initial || {}) }                   // [:218] defaults, then overlay initial
```

### The trap: spread is a **shallow** copy (one level deep)

`{ ...o }` copies only the **top-level** keys. If a value is itself an object, the **copy and
the original still share that inner object**:

```js
const a = { name: 'A101', meta: { floor: 2 } }
const b = { ...a }          // shallow copy
b.name = 'B202'             // top-level: independent ✅  (a.name still 'A101')
b.meta.floor = 9            // INNER object is shared ❌
a.meta.floor                // → 9   (changed a too!)
```

```
 a ─┐                    ┌─→ { name:'A101' }   (b got its own top level)
    └─→ { name, meta ─┐
                      └────→ { floor: 9 }      ← BOTH a.meta and b.meta point here
 b ─→ { name, meta ───┘
```

To update something nested without touching the original, spread **at each level** you change:

```js
const b = { ...a, meta: { ...a.meta, floor: 9 } }   // new outer AND new inner
a.meta.floor   // → still 2 ✅
```

(For our forms this rarely bites because the form is flat — but the day you nest state, this
is the bug you'll spend an hour on. Now you know it.)

### Function arguments are references too

Passing an object to a function passes the **pointer**, so mutating it inside changes the
caller's object:

```js
function bump(o) { o.x = 99 }
const thing = { x: 1 }
bump(thing)
thing.x          // → 99   (the function changed the caller's object)
```

Same as Python and Java. Prefer returning a new object (`return { ...o, x: 99 }`) over mutating
an argument — it avoids surprises.

### Arrays work exactly the same way

Arrays are objects too, so all of the above applies — `[...arr]` is the array spread, and
`arr2 = arr` shares. (That's the next study topic; just know the reference rule transfers.)

### Drills (answers below)

1. After `const o = { x: 1 }; const p = o; p.x = 5;` — what is `o.x`?
2. Is `{ a: 1 } === { a: 1 }` true or false? Why?
3. Why won't `form.name = 'X'; setForm(form)` reliably update the screen in React?
4. `const b = { ...a }` where `a = { tags: ['x'] }`. After `b.tags.push('y')`, what is `a.tags`?
5. Write a new object that is `form` but with `capacity` set to `50`, leaving `form` untouched.

<details><summary>Answers</summary>

1. `5` — `p` and `o` are the same object.
2. **false** — two separate objects; `===` compares identity, not contents.
3. You mutated the *same* object, so `oldState === newState` is still `true`; React sees no change. Pass a new object: `setForm({ ...form, name: 'X' })`.
4. `['x', 'y']` — spread is shallow, so `a.tags` and `b.tags` are the same array.
5. `const next = { ...form, capacity: 50 }`.
</details>

---

## Quick reference — the patterns you'll reread our code with

```js
obj.key                         // dot: literal key
obj[expr]                       // bracket: key from a value/variable
obj.key ?? 'fallback'           // (or ||) default when missing
obj?.key                        // safe read; undefined if obj is null/undefined
const { a, b } = obj            // destructure fields out
const copy = { ...obj }         // shallow copy
const next = { ...obj, k: v }   // copy with one field changed  ← React
const dyn  = { [k]: v }         // key computed from variable k
JSON.stringify(obj)             // object → text
JSON.parse(text)                // text → object
```

**One browser experiment** (open DevTools → Console, F12):
```js
const r = { name: 'A101', capacity: 30 }
r.name; const k = 'capacity'; r[k]        // dot vs bracket
const r2 = { ...r, capacity: 50 }          // copy-with-change
r === r2                                   // false — different objects
r.missing                                  // undefined, no crash
```

**Learn more:** [MDN — Working with objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Working_with_objects) ·
[javascript.info — Objects](https://javascript.info/object) ·
[javascript.info — Object references and copying](https://javascript.info/object-copy)

---

## Changelog
- **2026-06-12** — Created during objects study session. Part 1 overview + deep dives on dot/bracket and references/spread, grounded in `ResourcesPage.jsx` and `authStore.js`.
