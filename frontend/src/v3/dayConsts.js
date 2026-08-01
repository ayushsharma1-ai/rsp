// Shared day/week grid constants + helpers (used by CalendarV3 and DayGrid).
import { parseISO } from 'date-fns'

// The grid shows the working day only — 8 AM to 9 PM. Nobody schedules a class
// at 3 AM, and rendering the empty small hours wasted most of the screen.
// Anything already booked outside this window is CLAMPED to the edge rather than
// hidden (see clampBand) so it can never silently disappear.
export const DAY_START = 8, DAY_END = 21
export const DAY_PX = 56, WK_PX = 44

// Sliver height for something scheduled outside the window. Event chips can't
// render shorter than their own padding — 8px in the day grid, 12px in the week
// grid — so reserve the larger of the two; anything smaller and the bottom marker
// paints past the end of the grid.
const EDGE_PX = 12

// Place an event in the visible band. Returns {top, height, clipped}, in px,
// never escaping the grid. An event that overlaps the window is trimmed to it;
// one entirely outside becomes a sliver pinned to the nearest edge, so an odd-hour
// booking is still *visible* instead of silently vanishing off-grid.
export function clampBand(startDate, endDate, pxPerHour, minPx = 24) {
  const mins = (d) => d.getHours() * 60 + d.getMinutes()
  const lo = DAY_START * 60, hi = DAY_END * 60
  const gridPx = ((hi - lo) / 60) * pxPerHour

  const s = mins(startDate)
  const e = mins(endDate) > s ? mins(endDate) : s + 30   // 0-length or crosses midnight

  if (e <= lo) return { top: 0, height: EDGE_PX, clipped: true }              // ends before 8 AM
  if (s >= hi) return { top: gridPx - EDGE_PX, height: EDGE_PX, clipped: true } // starts after 9 PM

  const vs = Math.max(s, lo), ve = Math.min(e, hi)
  const top = ((vs - lo) / 60) * pxPerHour
  const height = Math.min(Math.max(((ve - vs) / 60) * pxPerHour, minPx), gridPx - top)
  return { top, height, clipped: s < lo || e > hi }
}

// data value — "HH:MM", what the API and the pickers exchange
export const hhmm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

// display value — "1:30 PM", what people read (the whole app speaks 12-hour)
export const t12 = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export const evMins = (iso) => { const d = parseISO(iso); return d.getHours() * 60 + d.getMinutes() }

// Scroll so `hour` sits near the top of the viewport. The 24-hour grid stays
// complete — this only decides where you LAND (nobody schedules at midnight).
//
// Finds the element that actually scrolls: an ancestor styled overflow:auto
// that really overflows (the move-overlay body), else the page itself — on the
// calendar screens .v-content is styled `auto` but .v-app grows instead, so
// the document scrolls. The old version trusted the style and scrolled a div
// that had nothing to scroll, which is why views opened at 12 AM.
export function scrollToHour(gridEl, hour, pxPerHour) {
  if (!gridEl) return
  let sc = gridEl.parentElement
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY
    if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight + 1) break
    sc = sc.parentElement
  }
  const y = (hour - DAY_START) * pxPerHour - 8            // small breathing room above
  if (sc && sc !== document.body) {
    const gridTop = gridEl.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop
    sc.scrollTo({ top: Math.max(0, gridTop + y), behavior: 'auto' })
  } else {
    // page scroll — keep the target hour clear of the sticky topbar (mobile;
    // on desktop the topbar is display:none and measures 0)
    const bar = document.querySelector('.v-topbar')
    const barH = bar ? bar.getBoundingClientRect().height : 0
    const gridTop = gridEl.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: Math.max(0, gridTop + y - barH), behavior: 'auto' })
  }
}

// Lay overlapping day events into side-by-side columns. Returns [{ e, col, cols }].
export function layoutOverlaps(evts) {
  const items = evts
    .map(e => ({ e, s: evMins(e.start), en: Math.max(evMins(e.end), evMins(e.start) + 20) }))
    .sort((a, b) => a.s - b.s || a.en - b.en)
  const out = []
  let cluster = [], clusterEnd = -1
  const flush = () => {
    const colEnds = []
    cluster.forEach(it => {
      let c = 0
      for (; c < colEnds.length; c++) if (it.s >= colEnds[c]) break
      it.col = c; colEnds[c] = it.en
    })
    const cols = colEnds.length
    cluster.forEach(it => out.push({ e: it.e, col: it.col, cols }))
    cluster = []
  }
  items.forEach(it => {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1 }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en)
  })
  flush()
  return out
}

// How far each cascade step insets a week block, and how many steps before it stops.
// Beyond ~3 a column that narrow has nothing left to draw a title in.
export const WK_CASCADE_PX = 5
const WK_CASCADE_MAX = 3

// Overlap layout for the WEEK grid, which cannot use the side-by-side lanes above:
// seven columns on a phone is roughly 42px each, so two lanes would leave ~20px and
// no room for a title. Blocks CASCADE instead — each inset from the left so a sliver
// of the one behind stays visible — and the front block carries a "+N" badge.
//
// Before this the week grid drew every block at the same left/width, so overlapping
// events sat exactly on top of one another and only the last one painted was visible.
// A clash was not merely hard to see in week view, it was indistinguishable from a
// single event.
//
// Per event: `depth` = cascade step; `over` = how many events genuinely run at the
// same time as this one (not the cluster size — a cluster can be a CHAIN whose ends
// never meet, and claiming "+2" on a block that overlaps one event would be a lie);
// `front` = nothing is drawn over it, so it is the one that shows the badge.
export function stackOverlaps(evts) {
  const items = evts
    .map(e => ({ e, s: evMins(e.start), en: Math.max(evMins(e.end), evMins(e.start) + 20) }))
    // longest first on a tie, so the big block sits at the BACK of the cascade and
    // the short one on top stays fully legible
    .sort((a, b) => a.s - b.s || b.en - a.en)
  const out = []
  let cluster = [], clusterEnd = -1
  const flush = () => {
    cluster.forEach((it, i) => {
      const over = cluster.filter(o => o !== it && o.s < it.en && o.en > it.s)
      out.push({
        e: it.e,
        depth: Math.min(i, WK_CASCADE_MAX),
        over: over.length,
        // later in `cluster` = drawn later = on top. Front means every event this one
        // overlaps comes before it, so nothing covers it.
        front: over.every(o => cluster.indexOf(o) < i),
      })
    })
    cluster = []
  }
  items.forEach(it => {
    if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1 }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en)
  })
  flush()
  return out
}
