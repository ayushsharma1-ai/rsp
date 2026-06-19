// v3 fixed pick-lists (per spec) + best-effort mapping onto real backend rows.
// The labels are fixed; we map them to actual /resources and /groups by name so
// bookings + clash detection still work against the live API.

// Room colours — muted, warm-leaning tones tuned to the graphite & amber theme
// (distinct from the event-kind colours; readableOn() keeps text legible on each).
export const VENUES = [
  { key: '601H-N', label: '601H-N', sub: 'Computer room', color: '#5f7aa6', online: false },
  { key: '601H-O', label: '601H-O', sub: 'Classroom', color: '#7c8c54', online: false },
  { key: '601H-P', label: '601H-P', sub: 'Classroom', color: '#8a6f9c', online: false },
  { key: 'online', label: 'Online', sub: 'Add a meeting link', color: '#9c7b59', online: true },
]

// Cohesive category palette for the graphite & amber theme — muted, mid-tone,
// readable in both light and dark.
export const EVENT_COLORS = [
  '#d99a4e', '#c06a43', '#7c8c54', '#4f8a80',
  '#5f7aa6', '#8a6f9c', '#9c7b59', '#b0894a',
]

export const GROUPS = [
  { key: 'mdes1', label: 'MDes 1st year' },
  { key: 'mdes2', label: 'MDes 2nd year' },
  { key: 'phd', label: 'PhD' },
  { key: 'faculties', label: 'Faculties' },
  { key: 'staff', label: 'Staff' },
]

// Normalize for matching. Note: the room the spec calls "601H-O" is stored in
// the DB as "601H-0" (a zero), so we fold 0→o before comparing.
const norm = (s) => (s || '').toLowerCase().replace(/0/g, 'o').replace(/[^a-z0-9]/g, '')

// Match a fixed venue to a real resource by token (e.g. "601h-n" inside the name).
export function resourceForVenue(venue, resources) {
  const token = norm(venue.key)
  return resources.find(r => norm(r.name).includes(token)) || null
}

// Match a fixed group label to a real group by normalized name.
export function groupIdForLabel(label, groups) {
  const n = norm(label)
  const hit = groups.find(g => norm(g.name) === n)
    || groups.find(g => norm(g.name).includes(n) || n.includes(norm(g.name)))
  return hit ? hit.id : null
}

// Color used for an event, looked up from its venue/resource name.
export function venueColorForName(resourceName) {
  if (!resourceName) return '#9c7b59' // online / unspecified (warm taupe)
  const n = norm(resourceName)
  const v = VENUES.find(x => !x.online && n.includes(norm(x.key)))
  return v ? v.color : '#8a8276'      // other / unmatched (warm gray)
}

// Pick black or white text for a given background so it's always readable —
// works for any venue/custom color in either theme. Uses the YIQ brightness rule.
export function readableOn(bg) {
  if (typeof bg !== 'string' || bg[0] !== '#') return '#ffffff'
  let h = bg.slice(1)
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return '#ffffff'
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#0b0d15' : '#ffffff'   // light bg -> dark text, dark bg -> white
}
