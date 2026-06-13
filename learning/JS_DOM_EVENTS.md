# DOM, Events & Propagation — crisp notes

> Stage 2 of [`FRONTEND_STUDY_PATH.md`](FRONTEND_STUDY_PATH.md). Quick-reference notes from the
> events deep-dive. Hands-on sandbox: [`playgrounds/events-playground.html`](playgrounds/events-playground.html).
> _Last updated: 2026-06-14._

---

## 1. The DOM
- When a page loads, the browser builds a **tree of objects — one per element**. That tree is the **DOM** (Document Object Model).
- Elements are **nested** inside each other (this nesting is the basis of propagation).
- **Change a DOM object → the screen changes.** The DOM *is* the page.
- Plain JS edits it by hand (`document.getElementById('x').textContent = …`); **React edits it for you** — you describe the UI, React updates the DOM. Only direct touch in the app: `createRoot(document.getElementById('root'))`.

## 2. Events & handlers
- **Event** = something that happened: `click`, `keydown`, `change`, `submit`.
- **Handler** = the function that runs in response. Pattern: *"when X happens, run this."*
- React: `onClick={fn}`, `onChange={fn}`, `onSubmit={fn}`.

## 3. The event object `e`
When an event fires, the browser hands your handler an **event object** (`e`):
- `e.target` — the element that fired the event.
- `e.target.value` — what's typed in an input (use for text/select).
- `e.target.checked` — true/false for a checkbox.

## 4. `preventDefault` vs `stopPropagation` (different things!)
| Call | Stops what? | Example |
|---|---|---|
| `e.preventDefault()` | the browser's **default action** | stop a form from reloading the page |
| `e.stopPropagation()` | the event's **travel** through the DOM | stop a click bubbling to a parent |

They're independent — neither affects the other.

---

## 5. Propagation — the round trip ⭐
Every event makes a **full round trip** through the DOM:

```
DOWN  (capturing):  document → … → ancestors → TARGET
                    TARGET = the element you actually clicked
UP    (bubbling):   TARGET → ancestors → … → document
```

- The trip starts at the **document root** (above it, `window`) — **not** the immediate parent — and passes through **every ancestor**, down to the target and back up.
- The event travels through the **target and its ancestors only** — **never down into the target's children**.

## 6. The third argument — `true` / `false`
```js
el.addEventListener('click', fn, true)   // CAPTURING — fires on the way DOWN
el.addEventListener('click', fn)         // BUBBLING (default) — fires on the way UP
```
| Phase | 3rd arg | Order (clicking the inner button) |
|---|---|---|
| Capturing | `true` | grandparent → parent → child (**top-down**) |
| Bubbling | `false`/omitted | child → parent → grandparent (**bottom-up**) |

## 7. Key facts that fix the confusion
- **Both phases ALWAYS happen.** The third argument does **not** turn a phase on/off — it only chooses **which phase your *listener* reacts on.**
- A capturing handler rings on the down pass; a bubbling handler rings on the up pass. (The other phase still happens — you just had no listener for it.)
- A single listener fires **once**, on its chosen phase.
- **React `onClick` is bubbling-phase** (for capturing it's `onClickCapture`).

## 8. `addEventListener` vs `onclick`
| | multiple handlers? | can choose capturing? |
|---|---|---|
| `el.onclick = fn` | ❌ one only (reassigning overwrites) | ❌ bubbling only |
| `el.addEventListener(...)` | ✅ as many as you want | ✅ `true`/`false` |

This is why we could attach **both** a capture and a bubble listener and watch the full trip. React's `onClick` uses `addEventListener` under the hood.

---

## 9. The Modal pattern (the payoff)
```jsx
<div className="modal-backdrop" onClick={onClose}>            // OUTER — closes on click
  <div className="modal" onClick={e => e.stopPropagation()}>  // INNER — halts the bubble
    ...form...
  </div>
</div>
```
Goal: click **outside** the box → close; click **inside** → stay open.

| You click… | Target | Modal on the event's path? | What happens |
|---|---|---|---|
| dark backdrop | backdrop | ❌ no (modal is a *child* of target) | `onClose` fires → **closes** |
| inside the box | a field | ✅ yes (modal is an *ancestor*) | `stopPropagation` halts bubble before backdrop → **stays open** |

**Why it works (timing):** both `onClick`s are bubbling-phase. On the way **up**, the event hits the **modal (inner) before the backdrop (outer)**, so `stopPropagation` fires *first* and the backdrop's `onClose` never runs.

### The golden rule
> Behavior comes down to one question: **is the inner box an *ancestor* of whatever you clicked?**
> - Clicked the backdrop → modal is *not* an ancestor → its `stopPropagation` never runs → **closes**.
> - Clicked inside → modal *is* an ancestor → its `stopPropagation` runs → **stays open**.

---

## 10. Practice
- Sandbox file: [`playgrounds/events-playground.html`](playgrounds/events-playground.html) (toggles for capturing + stopPropagation).
- No-file way: open `about:blank` → F12 → Console, paste a `document.body.innerHTML = \`…\`` with nested divs + `addEventListener` lines.
- `console.clear()` only wipes printed text — your page/listeners survive; reload (F5) to truly start over.

**Learn more:** [javascript.info — Bubbling and capturing](https://javascript.info/bubbling-and-capturing) ·
[MDN — Event.stopPropagation](https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation)

---

## Changelog
- **2026-06-14** — Created from the DOM/events/propagation session.
