import React from 'react'
import { format, parseISO, startOfDay } from 'date-fns'
import { ChevronDown } from 'lucide-react'

// Tappable date label that opens the OS date picker, so you jump to any day in
// ONE tap instead of stepping day-by-day. A native <input type="date"> sits
// invisibly over the label and IS the tap target, so it works on iOS, Android
// and desktop with no custom calendar UI to maintain.
export default function DateJump({ day, onPick, fmt = 'EEE, MMM d' }) {
  // NEVER throw on a missing/invalid date. Callers legitimately render one frame
  // before their effect fills the real date in — a sheet seeds its date state from
  // a prop that only arrives when it opens — and date-fns `format()` raises a
  // RangeError on an invalid Date, which unmounts the whole tree and shows a BLANK
  // PAGE. Falling back to today keeps that one frame harmless; the effect replaces
  // it immediately. Guarding here protects every call site at once.
  const safeDay = (day instanceof Date && !Number.isNaN(day.getTime()))
    ? day
    : startOfDay(new Date())
  return (
    <label className="v-datejump">
      <span style={{ fontWeight: 700 }}>{format(safeDay, fmt)}</span>
      <ChevronDown size={14} style={{ opacity: 0.55, flex: '0 0 auto' }} aria-hidden="true" />
      <input type="date" value={format(safeDay, 'yyyy-MM-dd')} aria-label="Jump to a date"
        // Guard the OUTPUT too, not just the input prop above. A native date field
        // accepts years past 9999 (Chrome goes to 275760), and date-fns parseISO
        // returns an Invalid Date for those — which every caller then feeds to a
        // state setter and dereferences with .toISOString() inside an effect. A
        // throw in an effect unmounts the tree: BLANK PAGE, work lost. Drop the
        // pick instead; the field keeps showing the last good date.
        onChange={e => {
          if (!e.target.value) return
          const picked = startOfDay(parseISO(`${e.target.value}T00:00`))
          if (!Number.isNaN(picked.getTime())) onPick(picked)
        }}
        // fontSize MUST stay >= 16px even though the input is invisible: iOS Safari
        // zooms the whole page in whenever a focused field is smaller than that, and
        // it does NOT zoom back out afterwards. The UA default for <input> is
        // 13.33px, so without this every date tap left the app zoomed in.
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, border: 'none', padding: 0, margin: 0, background: 'transparent', cursor: 'pointer', fontSize: '16px' }} />
    </label>
  )
}
