// One shared unread count for the Activity tab's dot.
//
// The dot is drawn by AppShellV3, but read state is CHANGED by NotificationsV3 —
// two components with no relationship. Each used to fetch and keep its own count,
// so "Mark all read" cleared the list instantly while the dot sat there until the
// shell happened to refetch: either its 30s poll, or a route change (it refreshes
// on loc.pathname). That is exactly the reported bug — the dot only went away
// when you moved to another tab.
//
// Deliberately a tiny module-level store rather than context or Zustand: the shell
// wraps the router, so a provider would have to sit above it and the count would
// still need pushing UP from a route. A module both sides import has no such
// direction.
let count = null                 // null = nobody has loaded it yet
const subs = new Set()

export function publishUnread(n) {
  const next = Math.max(0, Number(n) || 0)
  if (next === count) return     // no-op writes would re-render the shell on every poll
  count = next
  subs.forEach(fn => fn(count))
}

// The current count, or null if it has never been loaded. Lets a late-mounting
// subscriber paint the right thing on its FIRST frame instead of flashing 0.
export function peekUnread() { return count }

export function subscribeUnread(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}
