# Frontend Study Path — to understand this app (and your Vue syllabus)

> **Who this is for:** you — comfortable with Python/OOP/Java, new to frontend.
> **Goal:** learn just enough, *in the right order*, to read the React code in this project
> and follow my explanations. Your course teaches **Vue**; this app is **React**. The ideas
> are the same — I map them.
>
> **How to use:** study **Stage 1 first** (it's 80% of everything). Then Stage 2. Then pick
> Stage 3 (Vue, for your course) and Stage 4 (React, for this codebase) — they cover the same
> concepts twice, which will reinforce them. Don't try to memorize; aim to *recognize*.

---

## You already know (lean on this)
- **Variables, functions, loops, conditionals, scope** — same ideas as Python/Java.
- **Objects** in JS ≈ a mix of a Python **dict** and a Java **object**.
- **Arrays** ≈ Python lists.
- **OOP**: JS has classes too, but modern React/Vue mostly uses **functions**, not classes.
- The hard new idea isn't syntax — it's **reactivity**: "change data → screen updates by itself." Focus your energy there.

---

## Stage 1 — JavaScript language essentials ⭐ (study this first)
This is the core. Everything else builds on it.

| Concept | What it is | Why it matters here |
|---|---|---|
| `let` / `const` | variable declarations (`const` = no reassign) | every line of our code |
| Types & strings | numbers, strings, booleans, `null`, `undefined` | API data, labels |
| **Template literals** `` `Hi ${name}` `` | strings with values injected | `roomLabel` builds `"Classroom A101"` |
| **Objects** `{ key: value }` | key→value bags (like a dict) | every API item is an object (`r.name`, `r.id`) |
| Dot vs bracket access | `r.name` vs `obj[variable]` | `TYPE_LABEL[r.resource_type]`, `availability[r.id]` |
| **Arrays** `[...]` | ordered lists | the list of rooms |
| **Array methods**: `map`, `filter`, `find`, `forEach` | transform/select lists | `TYPES.map(...)`, `filtered.filter(...)` |
| **Arrow functions** `x => x + 1` | short function syntax | callbacks everywhere |
| **Destructuring** `const { user } = store` | pull fields out in one line | props, store, hooks |
| **Spread/rest** `...` | copy/merge objects & arrays | `{ ...form, name: 'x' }` |
| Truthy/falsy + `&&` / `||` / `?.` | shortcuts for "exists?" / fallback / safe access | `availability && (...)`, `user?.role`, `a || b` |
| **Ternary** `cond ? a : b` | inline if/else | green/orange dot color |
| **Modules** `import` / `export` | split code across files | top of every file |
| **JSON** + `JSON.parse` / `stringify` | text format for data | what the API sends/receives |
| **Promises** + `async` / `await` + `.then()` | handle results that arrive *later* | every API call |

**Best resources:** [javascript.info — The JavaScript language](https://javascript.info/js) (parts 1–2 cover all of the above) · [MDN JS Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide). Maps to your **course Weeks 1–2**.

---

## Stage 2 — The browser & async (a short stage)
| Concept | Why it matters here |
|---|---|
| What the DOM is | the page React draws into |
| Events (`click`, `change`, `submit`) | buttons, the date picker, forms |
| `fetch` / HTTP basics (GET/POST, status codes) | how frontend talks to the backend |
| `localStorage` | where the login token is kept |
| The **event loop** (why async exists) | why `await` doesn't freeze the page |

**Resources:** [javascript.info — Network requests](https://javascript.info/network) · [MDN — Intro to events](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Building_blocks/Events). Maps to **Week 5**.

---

## Stage 3 — Vue (your syllabus)
Learn these from your course; they're the same concepts this app uses, just Vue's words.

| Vue concept | One-line meaning |
|---|---|
| **Reactivity** | change data → template re-renders automatically (the big idea) |
| Template `{{ expr }}` | show a value in HTML |
| `v-bind` / `:attr` | bind an attribute to data |
| `v-model` | two-way bind a form input |
| `v-on` / `@click` | run code on an event |
| `v-if` / `v-show` | show something conditionally |
| `v-for` + `:key` | render a list (and why keys are needed) |
| **Components + props** | reusable blocks; pass data in via props |
| **Computed** vs **methods** | derived values vs callable actions |
| **Lifecycle** (`mounted`, `watch`) | run code when component appears / when data changes |

**Resource:** [vuejs.org — Essentials](https://vuejs.org/guide/essentials/application.html). Maps to **Week 4**.

---

## Stage 4 — React (what THIS app uses), mapped from Vue
Once Vue clicks, React is a small translation. Same concept, React's name:

| Concept | Vue | React (this app) |
|---|---|---|
| Show a value | `{{ x }}` | `{x}` in JSX |
| Component | `.vue` file / options | a **function** that returns JSX |
| Pass data in | props (`:r="r"`) | props (`r={r}`) — arrives as function args |
| Local state | `data()` + `this.x = …` | `const [x, setX] = useState(...)`; change via `setX(...)` |
| Run on mount / on change | `mounted` / `watch` | `useEffect(fn, [deps])` |
| Event | `@click="f"` | `onClick={f}` |
| Conditional | `v-if` | `{cond && <X/>}` or ternary |
| List | `v-for` + `:key` | `arr.map(x => <X key={...}/>)` |
| Two-way input | `v-model` | `value={x} onChange={e => setX(e.target.value)}` (controlled input) |

**The one difference to internalize:** Vue watches your assignments automatically; React makes you call the **setter** (`setX`) so it knows to re-render. Same result.

**Resource:** [react.dev — Learn React](https://react.dev/learn) (sections: Describing the UI, Adding Interactivity, Managing State).

---

## Stage 5 — The whole picture (how data flows in this app)
Once Stages 1–4 make sense, this sentence should read clearly:

> The page asks the backend for data (**Axios**, Stage 2) → stores it in **state** (Stage 4) →
> React **renders** the state into UI by **mapping** arrays into components (Stages 1, 4) →
> when the user acts (picks a date), a **setter** updates state → React re-renders.

That loop — **fetch → state → render → event → state → render** — is the entire frontend.

---

## Suggested 1-week plan (light, ~1 hr/day)
- **Day 1–2:** Stage 1 (objects, arrays, `map`/`filter`, arrow functions, destructuring, ternary, `&&`/`?.`).
- **Day 3:** Stage 1 finish (template literals, modules, JSON) + Stage 2 (events, fetch, promises/async).
- **Day 4–5:** Stage 3 Vue essentials (reactivity, directives, components/props, computed, lifecycle).
- **Day 6:** Stage 4 React mapping — then re-read this project's `ResourcesPage.jsx`; it should mostly make sense.
- **Day 7:** Stage 5 — trace one feature end to end, and bring me your questions.

When you're ready, open any file I've changed and ask: *"explain the concepts used here."* I'll break it down against this exact vocabulary.
