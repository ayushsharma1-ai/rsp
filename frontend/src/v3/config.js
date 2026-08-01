// NOTE (2026-07-20): these lists are NO LONGER the source of truth for what
// exists. Rooms and groups are now read live from /resources and /groups, and
// picked by id — see CreateEventV3 / CalendarV3.
//
// They used to be fixed pick-lists "best-effort mapped" onto backend rows by
// name. That failed SILENTLY on a fresh database: no match meant the event was
// created with no room booking at all, so two people could both "book" the same
// room and never be warned. Do not reintroduce that pattern.
//
// The last of that pattern went on 2026-07-23: room colours are no longer looked
// up in a fixed VENUES list either. That list only knew 601H-N/O/P, so every
// other room — 16 of the 21 in the department — fell through to one identical
// grey. Colours are now derived from the room's own name (see venueColorForName),
// so a room added in Settings gets a stable colour with nothing to maintain.

// ── The content palette (2026-07-31) ────────────────────────────────────────
// SIXTEEN colours, in a light and a dark variant, because both changed at once:
//
//   1. Colour now identifies a COURSE, not a kind. Every class used to share one
//      colour, since eventColor read kind_color first — so a week of teaching was
//      one flat block of the same hue. There are 16 courses in the department
//      timetable, hence 16 colours.
//   2. The day theme went cool white and the night theme is now cool neutral
//      (#131316). One set cannot serve both grounds: the old set put Grape at
//      2.63:1 and Blueberry at 2.70:1 against the dark page, under the 3:1 floor
//      for non-text. Google Calendar ships two sets for exactly this reason.
//
// These were SOLVED, not picked, because four constraints have to hold at once and
// picking by eye satisfies at most three. Hand-chosen candidates failed twice: an
// extended Google set left Banana at 1.69:1 on white, and an evenly-lit set hit the
// contrast floor perfectly but made every colour the same lightness, so neighbouring
// hues became indistinguishable (closest pair Δ29). The rule that fixes it is the one
// real calendar palettes already use — vary lightness on purpose. Three lightness
// tiers cycle through the hues; Google's own spread runs from Banana at 1.7:1 to
// Grape at 7:1 for the same reason.
//
// Verified over the whole set: every colour ≥3.4:1 on white and ≥4.8:1 on #131316;
// closest pair Δ41 (light) and Δ31 (dark). Hue spacing is perceptual, not uniform —
// the eye splits blues and purples finely and greens coarsely, so the green band is
// sampled less densely than the blue-violet one.
//
// A course keeps its HUE across themes and only shifts lightness, so it stays
// recognisably "the blue one" whichever theme you are in.
const COURSE_LIGHT = [
  '#2491de', '#3868d9', '#4742d3', '#9b68e8', '#af2dd7', '#99248d', '#e554a6', '#d32850',
  '#a03226', '#db6b21', '#886b1a', '#585d16', '#5d9a17', '#268018', '#186638', '#179b92',
]
const COURSE_DARK = [
  '#3c88be', '#8199d0', '#acaade', '#966ed1', '#bf83d1', '#d89bd2', '#cb5a9a', '#d18395',
  '#d8a19b', '#bc6f3b', '#b49643', '#aeb547', '#618f2d', '#4fad40', '#60c189', '#2e908a',
]
// Slot names, so these can be talked about. Index-aligned with both arrays above.
export const COLOR_NAMES = [
  'Azure', 'Cobalt', 'Indigo', 'Violet', 'Grape', 'Magenta', 'Cerise', 'Rose',
  'Tomato', 'Ember', 'Amber', 'Citron', 'Chartreuse', 'Fern', 'Emerald', 'Teal',
]

// The authoring set — what the colour picker in Settings → Kinds offers, and what a
// stored kind_color is expected to be drawn from. Light variants, because a colour
// saved in the database is a single value and the light one is the canonical form;
// forTheme() converts it for display on dark.
export const EVENT_COLORS = COURSE_LIGHT

const ONLINE_COLOR = '#6b7280'   // the one pseudo-venue, always itself

// The block colour for an event carrying no course, no kind and no room. Exported
// because three day-grid call sites had this hex inlined, which meant a palette
// re-tune silently missed them.
export const UNTAGGED = '#6b7280'

const DARK_GROUND = '#131316'
const isDark = (theme) => theme !== 'light'

// ── Course identity ─────────────────────────────────────────────────────────
// Pull a course code out of a title. The timetable import writes "DES601 · Design
// Theory"; people typing by hand write "DES 635" or "DES-635". All three normalise to
// the same key, so one course is one colour however it was entered.
export function courseKey(title) {
  const m = String(title || '').match(/\b([A-Za-z]{2,4})\s*-?\s*(\d{3}[A-Za-z]?)\b/)
  return m ? (m[1] + m[2]).toUpperCase() : null
}

// FNV-1a: small, deterministic, and spreads similar strings ("DES663" vs "DES665")
// across different buckets rather than clustering them.
function fnv(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h
}

// Fixed assignments for the department's timetable — hardcoded so a course's colour
// never moves, not even if the palette is reordered or a course is renamed.
//
// The slot numbers are not sequential on purpose. Courses are usually read in code
// order, and consecutive palette slots are adjacent hues, so a straight 0,1,2,3 mapping
// would give DES601 and DES630 near-identical blues. Walking the wheel in bit-reversed
// order (0, 8, 4, 12, 2, 10 …) puts each new course as far from the previous one as the
// wheel allows.
export const COURSE_COLORS = {
  DES601: 0,   // Azure
  DES630: 8,   // Tomato
  DES635: 4,   // Grape
  DES638: 12,  // Chartreuse
  DES640: 2,   // Indigo
  DES644: 10,  // Amber
  DES649: 6,   // Cerise
  DES653: 14,  // Emerald
  DES654: 1,   // Cobalt
  DES655: 9,   // Ember
  DES657: 5,   // Magenta
  DES661: 13,  // Fern
  DES663: 3,   // Violet
  DES665: 11,  // Citron
  DES666: 7,   // Rose
  DES681: 15,  // Teal
}

// The palette slot for a course, or null if the title carries no course code.
// A course not in COURSE_COLORS still gets a stable slot from its code, so adding
// DES700 next semester needs no code change — list it only to pin a specific colour.
export function courseSlot(title) {
  const k = courseKey(title)
  if (!k) return null
  return Object.prototype.hasOwnProperty.call(COURSE_COLORS, k)
    ? COURSE_COLORS[k]
    : fnv(k) % COURSE_LIGHT.length
}

// Room colour, derived from the room's own name so EVERY room gets one — no list
// to keep in sync, and the same room always draws the same colour on every device.
export function venueColorForName(resourceName, theme) {
  if (!resourceName) return ONLINE_COLOR
  const n = resourceName.trim().toLowerCase()
  const set = isDark(theme) ? COURSE_DARK : COURSE_LIGHT
  return set[fnv(n) % set.length]
}

// ── Contrast ────────────────────────────────────────────────────────────────
const INK = '#0b0d15'

function parse(hex) {
  let h = String(hex).replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return v.some(Number.isNaN) ? null : v
}

// Relative luminance, per WCAG. Needed because the YIQ shortcut this used to rely
// on is not a contrast measure: it rated Sage #33b679 as "dark enough for white
// text" (YIQ 136) when white on it is only 2.59:1 — below even the 3:1 floor for
// large text. YIQ weights green heavily, so mid-bright greens and cyans slip through.
function luminance([r, g, b]) {
  const f = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a, b) {
  const [A, B] = [parse(a), parse(b)]
  if (!A || !B) return 21
  const [hi, lo] = [luminance(A), luminance(B)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const hexOf = ([r, g, b]) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// Raise a colour's lightness, keeping its hue, until it clears `target` on `ground`.
function lift(hex, ground, target) {
  const rgb = parse(hex)
  if (!rgb) return hex
  let [r, g, b] = rgb
  for (let i = 0; i < 60 && contrast(hexOf([r, g, b]), ground) < target; i++) {
    r += (255 - r) * 0.08; g += (255 - g) * 0.08; b += (255 - b) * 0.08
  }
  return hexOf([r, g, b])
}

// ── Theme conversion ────────────────────────────────────────────────────────
// A colour stored in the database (a kind's colour, an event's own colour) is one
// value, authored against the light theme. On dark it has to become its counterpart.
const LIGHT_TO_DARK = COURSE_LIGHT.reduce((m, c, i) => { m[c.toLowerCase()] = COURSE_DARK[i]; return m }, {})

export function forTheme(hex, theme) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex
  if (!isDark(theme)) return hex
  const twin = LIGHT_TO_DARK[hex.toLowerCase()]
  if (twin) return twin
  // Not from our palette — an admin typed a custom colour. Lighten it only if it
  // would otherwise disappear into the dark page. Anything already legible is left
  // exactly as chosen, because overriding a deliberate choice is worse than a
  // slightly dark block.
  return contrast(hex, DARK_GROUND) >= 3 ? hex : lift(hex, DARK_GROUND, 3.4)
}

// ── The one function that decides an event's colour ─────────────────────────
// Precedence, most specific first:
//   1. the event's own colour   — somebody set this event deliberately
//   2. its COURSE               — DES635 is always Grape, in every view
//   3. its KIND                 — Meeting, Seminar… for anything with no course code
//   4. its ROOM                 — so an untitled block still isn't grey
//
// The event's own colour used to come SECOND, behind the kind, which meant setting a
// colour on a single event did nothing whenever its kind had one. Most specific wins
// now. Safe to change: the timetable import never writes events.color, so every
// imported row is null and nothing shifts underneath the existing data.
export function eventColorFor(e, theme) {
  if (!e) return UNTAGGED
  if (e.color) return forTheme(e.color, theme)
  const slot = courseSlot(e.title)
  if (slot !== null) return (isDark(theme) ? COURSE_DARK : COURSE_LIGHT)[slot]
  if (e.kind_color) return forTheme(e.kind_color, theme)
  const venue = (e.venues && e.venues[0]) || null
  return venue ? venueColorForName(venue, theme) : UNTAGGED
}

// Pick dark or white text for a given background — whichever actually has more
// contrast on it. Works for any venue/custom colour in either theme.
export function readableOn(bg) {
  if (typeof bg !== 'string' || bg[0] !== '#') return '#ffffff'
  if (!parse(bg)) return '#ffffff'
  return contrast(bg, INK) > contrast(bg, '#ffffff') ? INK : '#ffffff'
}
