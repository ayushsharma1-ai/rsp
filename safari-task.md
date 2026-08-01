# Task: verify and fix RSP v3 on REAL iPhone Safari

Read `CLAUDE.md` first.

## Goal, in priority order

1. **iPhone Safari (iOS WebKit) — this is the priority.** The app is used on phones.
2. Mac Safari (desktop WebKit) — nice to have, do it after.

## Only v3 matters

`v3.html` → `src/main-v3.jsx` → `src/v3/` is the source of truth. **v1 and v2 are
retired — do not touch them.** Test at `/v3.html`.

## Setup (already done)

- Backend: `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000`
- Frontend: `cd frontend && npm run dev`
- Local Postgres holds a **real data snapshot from our production VM**, so the
  calendar has genuine recurring courses (DES6xx), venues, groups and bookings.
- Log in as `adminayush@iitk.ac.in`.

### Serving to a physical phone

Vite currently binds to localhost only, so a phone cannot reach it. Start it with:

```
npm run dev -- --host
```

Find the Mac's LAN IP with `ipconfig getifaddr en0`, then open
`http://<mac-ip>:5173/v3.html` on the phone (same Wi-Fi network).

**The API needs no reconfiguration.** `src/lib/api.js` uses a relative
`/api/v1` baseURL and `vite.config.js` proxies `/api` → `localhost:8000`, so
requests from the phone hit the Mac's IP and get proxied to the backend
automatically.

## ⚠️ How to test — read this before choosing a method

The defects below are all **software-keyboard / visualViewport** bugs. Method 3
below CANNOT reproduce any of them. Do not use it and conclude things are fine.

1. **Real iPhone + Safari Web Inspector — the gold standard.** On the phone:
   Settings → Safari → Advanced → Web Inspector = ON. Connect by USB. On the Mac:
   Safari → Develop → [iPhone name] → pick the page. You get a real console and
   element inspector attached to genuine iOS WebKit, with the real keyboard,
   real safe areas and real `visualViewport` behaviour.
2. **Xcode iOS Simulator — acceptable second best.** It runs a genuine iOS
   WebKit build. **Critical:** by default the simulator uses your Mac's hardware
   keyboard and shows **no on-screen keyboard at all** — which hides exactly
   these bugs. Turn the software keyboard on from the simulator's I/O → Keyboard
   menu before testing anything keyboard-related.
3. **Safari Responsive Design Mode — NOT sufficient, and misleading here.** It is
   desktop WebKit in a phone-shaped window with **no software keyboard**, so
   every keyboard defect below will appear "fixed" when it is not. Use it only
   for pure layout/CSS checks, never to sign off a keyboard fix.

## Background: why this matters

We previously fixed four iOS defects in v3, but they were only verified by
**emulating `visualViewport` in a headless Chromium**. That proved the
arithmetic, not real Safari — real-device behaviour was never verified. That is
the entire reason we are now on a Mac with a real iPhone available.

**Your job is to check whether those fixes actually hold in genuine iOS WebKit,
and to find what the emulation missed.** Assume nothing is verified until you
have seen it on a real device (or at minimum the simulator with the software
keyboard enabled).

## The four previously-fixed defects — re-verify each on a real iPhone

1. `SheetV3` clamped `maxHeight` unconditionally, so every sheet opened ~12px
   from the top, under the notch, with the backdrop reduced to an untappable
   sliver. It should only clamp **while the keyboard is up**.
2. **Login screen:** `html, body { overflow: hidden }` is global and deliberate,
   which means there is **no scrollable ancestor**, so iOS could not scroll the
   password field out from behind the keyboard. Fixed via the `useKeyboardFit()`
   hook.
3. `.v-app { position: fixed; inset: 0 }` never shrinks for the keyboard, so
   `.v-content` had zero scroll slack and fields in the lower half were
   unreachable on a small (667px) iPhone. Same hook, `{ scroll: false }`.
4. `<input type="date">` behind every `DateJump` inherited the UA default
   **13.33px**; anything under **16px** makes iOS zoom the page in permanently
   and never zoom back. Fixed with an `input, select, textarea { font-size: 16px }`
   floor in `v3.css` (buttons deliberately excluded).

## Two hard-won rules encoded in `src/v3/viewportKb.js` — do not regress these

- **Keyboard height is `innerHeight - vv.height`. Never subtract
  `vv.offsetTop` from it.** iOS shrinks the visual viewport *and then scrolls it
  down* to reveal the focused field — that scroll IS `offsetTop`. Subtracting it
  made the expression cancel to ~0 exactly while the keyboard was up, so the
  "keyboard is up" branch never ran. Two separate quantities, both needed:
  keyboard **height** = `innerHeight - vv.height` (offsetTop plays no part);
  **where the visible strip is** = `[offsetTop, offsetTop + height]`.
- **Sizing an element is not the same as placing it.** With the strip offset, an
  element's top is not the top of what you can see. Pin elements to the strip
  with `position: fixed`, and **never `transform`** — a transformed ancestor
  becomes the containing block for `position: fixed` descendants and silently
  re-anchors them.

## Also watch for

- **`date-fns` `format()` called on an Invalid Date throws and blanks the entire
  page.** Guard in the shared component, not per call site.
- **Responsive breakpoints must gate on height as well as width.** `@media
  (min-width: 768px)` alone gives iPhone landscape (844–932px wide but only
  390–430px tall) the iPad centred-column layout, leaving ~200px of dead gutter.
  600px of height cleanly separates phones from tablets.
- Test **both orientations**. The earlier emulation only tested portrait, and
  only `offsetTop = 0` — which is how all of this survived review.

## Reporting

When you are done, split your report into three explicit lists:

- **Fixed** — what you changed, and how you confirmed it on a real device.
- **Found but not fixed** — genuine defects you saw, with repro steps.
- **Not checked** — anything you could not verify on real hardware, and why.

Do not claim something works in Safari unless you actually observed it there.
Saying "not checked" is always better than implying coverage you do not have.
