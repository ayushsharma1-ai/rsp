// Shared mobile helpers — time slots + ISO builders (mirror desktop logic)
import { format } from 'date-fns'

export const TIME_SLOTS = []
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    const ampm = h < 12 ? 'AM' : 'PM'
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
    TIME_SLOTS.push({ value: `${hh}:${mm}`, label: `${displayH}:${mm} ${ampm}` })
  }
}

export function roundToNext30(d) {
  const ms = 1000 * 60 * 30
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

const pad = (n) => String(n).padStart(2, '0')
export function fmtLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function localDate(d) { return fmtLocal(d).slice(0, 10) }
export function localTime(d) { return fmtLocal(d).slice(11) }

// "2026-06-12" + "09:30" → ISO string in UTC
export function toISO(date, time) { return new Date(`${date}T${time}`).toISOString() }

export const fdate = (s, f = 'MMM d, HH:mm') => { try { return format(new Date(s), f) } catch { return s } }
