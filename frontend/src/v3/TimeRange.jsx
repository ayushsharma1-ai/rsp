import React from 'react'
import { DAY_START, DAY_END } from './dayConsts'

// Start/end time picking, the way Google Calendar does it on a phone: two plain
// fields, and tapping one opens the PLATFORM's own picker — the Material clock
// dial on Android, the wheel on iOS, a typeable field on desktop. Any minute is
// pickable (2:10 PM is fine); nothing to scroll, nothing to study.
//
// The chip-grid this replaces had ~20 buttons on screen at once and could only
// express :00/:30. The dropdowns before THAT were 27 options you scrolled blind.
//
// The 8 AM – 9 PM calendar window is enforced here too — but by an inline
// message + a blocked save, never by silently rewriting what the user chose.

const pad = (n) => String(n).padStart(2, '0')
const toMin = (hhmm) => { const [h, m] = (hhmm || '00:00').split(':').map(Number); return h * 60 + m }
const toStr = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
export const label12 = (hhmm) => {
  const [h, m] = (hhmm || '00:00').split(':').map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

const LO = DAY_START * 60, HI = DAY_END * 60

// One source of truth for what makes a range invalid. TimeRange shows it live;
// the create/edit sheets call it again on submit so an invalid range can never
// be saved even if this component isn't on screen.
export function timeRangeError(start, end, minStart) {
  const s = toMin(start), e = toMin(end)
  if (s < LO || e > HI || s >= HI)
    return `The calendar runs ${label12(toStr(LO))} – ${label12(toStr(HI))}.`
  if (e <= s) return 'End time must be after the start time.'
  if (minStart && s < toMin(minStart)) return 'That start time has already passed today.'
  return null
}

const durText = (mins) =>
  mins <= 0 ? null
    : mins < 60 ? `${mins} min`
    : mins % 60 === 0 ? `${mins / 60} hr`
    : `${Math.floor(mins / 60)} hr ${mins % 60} min`

export default function TimeRange({ start, end, onChange, minStart }) {
  const dur = toMin(end) - toMin(start)
  const err = timeRangeError(start, end, minStart)

  // Moving the start drags the end along, keeping the duration — so "shift my
  // 2-hour class from 10:00 to 2:10" is one edit, and the end can never be
  // stranded before the start.
  const changeStart = (v) => {
    if (!v) return                                       // field cleared mid-edit
    const keep = dur > 0 ? dur : 60
    onChange({ start: v, end: toStr(Math.min(toMin(v) + keep, HI)) })
  }
  const changeEnd = (v) => { if (v) onChange({ start, end: v }) }

  return (
    <div>
      <div className="v-timerow">
        <div>
          <label className="m-label">Starts</label>
          <input className="m-input" type="time" value={start} min={toStr(LO)} max={toStr(HI - 1)}
            onChange={(e) => changeStart(e.target.value)} />
        </div>
        <div>
          <label className="m-label">Ends</label>
          <input className="m-input" type="time" value={end} min={toStr(LO + 1)} max={toStr(HI)}
            onChange={(e) => changeEnd(e.target.value)} />
        </div>
      </div>
      {err
        ? <p className="m-error" style={{ margin: '6px 2px 0', fontSize: '0.8rem' }}>{err}</p>
        : <p className="m-muted" style={{ margin: '6px 2px 0', fontSize: '0.8rem' }}>
            {label12(start)} – {label12(end)} · lasts {durText(dur)}
          </p>}
    </div>
  )
}
