// v3 fixed pick-lists (per spec) + best-effort mapping onto real backend rows.
// The labels are fixed; we map them to actual /resources and /groups by name so
// bookings + clash detection still work against the live API.

export const VENUES = [
  { key: '601H-N', label: '601H-N', sub: 'Computer room', color: '#5b6ef5', online: false },
  { key: '601H-O', label: '601H-O', sub: 'Classroom', color: '#16a34a', online: false },
  { key: '601H-P', label: '601H-P', sub: 'Classroom', color: '#d97706', online: false },
  { key: 'online', label: 'Online', sub: 'Add a meeting link', color: '#a78bfa', online: true },
]

// Preset swatches for custom event color-coding (null = auto / venue color).
export const EVENT_COLORS = [
  '#5b6ef5', '#16a34a', '#d97706', '#a78bfa',
  '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6',
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
  if (!resourceName) return '#a78bfa' // online / unspecified
  const n = norm(resourceName)
  const v = VENUES.find(x => !x.online && n.includes(norm(x.key)))
  return v ? v.color : '#64748b'
}
