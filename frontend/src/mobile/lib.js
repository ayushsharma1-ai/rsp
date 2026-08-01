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
// Returns null (never throws) for a missing/unparseable date or time. `.toISOString()`
// raises RangeError on an Invalid Date, and callers evaluate this during RENDER from
// state that is still '' on the first frame — which unmounted React and showed a
// BLACK SCREEN. Submit paths already validate before sending, so null is safe there.
export function toISO(date, time) {
  if (!date || !time) return null
  const d = new Date(`${date}T${time}`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// 12-hour display by default — every picker in the app speaks "1:30 PM", so
// lists and detail rows shouldn't answer back in "13:30".
export const fdate = (s, f = 'MMM d, h:mm a') => { try { return format(new Date(s), f) } catch { return s } }

// FastAPI sends `detail` as a STRING for our own HTTPExceptions, but as an ARRAY of
// {loc,msg,type} objects for 422 validation errors — and slowapi's 429 uses `error`
// instead. Rendering an array/object in JSX throws "Objects are not valid as a React
// child", which unmounts the tree and shows a BLANK PAGE. Every API error message
// must go through here.
export function errText(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.response?.status === 429) return 'Too many attempts. Wait a minute.'
  const d = err?.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d
  if (Array.isArray(d)) {
    const msgs = d.map(x => (typeof x === 'string' ? x : x && x.msg)).filter(Boolean)
    if (msgs.length) return msgs.join('. ')
  }
  if (d && typeof d === 'object' && typeof d.msg === 'string') return d.msg
  const e = err?.response?.data?.error
  if (typeof e === 'string' && e.trim()) return e
  return fallback
}
