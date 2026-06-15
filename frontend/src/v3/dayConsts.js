// Shared day/week grid constants + helpers (used by CalendarV3 and DayGrid).
import { parseISO } from 'date-fns'

export const DAY_START = 0, DAY_END = 24   // full 24-hour grid
export const DAY_PX = 56, WK_PX = 44

export const hhmm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

export const evMins = (iso) => { const d = parseISO(iso); return d.getHours() * 60 + d.getMinutes() }

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
