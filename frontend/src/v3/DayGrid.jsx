import React, { useEffect, useRef, useState } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import { Btn } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import { DAY_START, DAY_END, DAY_PX, hhmm, t12, evMins, layoutOverlaps, scrollToHour, clampBand } from './dayConsts'

// The touch day grid: time rows, events (overlaps side-by-side), tap+drag to
// pick a slot, "now" line, and a confirm bar. Shared by event-create and
// event-move so both feel identical.
export default function DayGrid({ cursor, today, events, eventColor, confirmLabel = 'Add event', onConfirm, onEventTap, onSelect, sheetOpen }) {
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
  const dayEvents = (events || []).filter(e => isSameDay(parseISO(e.start), cursor))
  const isToday = isSameDay(cursor, today || new Date())
  const gridRef = useRef(null)
  const wrapRef = useRef(null)
  const dragHandle = useRef(null)
  const [box, setBox] = useState(null)   // { start, end } in minutes
  // The drag hint retires once you've dragged — it is an affordance cue, not status.
  const [dragged, setDragged] = useState(false)

  // clear the selection when an owning sheet closes (create flow passes its open flag)
  useEffect(() => { if (sheetOpen === false) setBox(null) }, [sheetOpen])

  // ...and whenever you step to a different day. A pick made on Wednesday used to
  // linger when you moved to Thursday: the bar still showed that time, the "+"
  // stayed hidden behind it, and its free/busy line silently re-evaluated against
  // the new day's events without the user touching anything.
  useEffect(() => { setBox(null) }, [cursor])

  // Keep the chosen slot in view. Selecting brings the confirm bar in, which
  // shortens the grid — so a slot picked at the bottom of the day (8–9 PM) could
  // end up scrolled just out of sight behind the fold.
  useEffect(() => {
    const wrap = wrapRef.current
    if (!box || !wrap) return
    // offsetTop, not 0: the scroller has top padding (headroom for the 8 AM
    // label), so the grid doesn't start at scroll position zero
    const gridTop = gridRef.current ? gridRef.current.offsetTop : 0
    const top = gridTop + ((box.start - DAY_START * 60) / 60) * DAY_PX
    const bottom = gridTop + ((box.end - DAY_START * 60) / 60) * DAY_PX
    const pad = 12
    // instant, not smooth: the scroll has to land before the user looks, and a
    // smooth scroll competing with the bar's entrance animation just lags
    if (bottom > wrap.scrollTop + wrap.clientHeight - pad) {
      wrap.scrollTop = bottom - wrap.clientHeight + pad
    } else if (top < wrap.scrollTop + pad) {
      wrap.scrollTop = Math.max(0, top - pad)
    }
  }, [box?.start, box?.end]) // eslint-disable-line react-hooks/exhaustive-deps

  // Report the current slot to the parent so the "+" button can create at the
  // SELECTED time (not a fixed default). Guarded on the snapped HH:MM value so a
  // drag doesn't spam the parent with re-renders when the 30-min slot is unchanged.
  // `undefined` means "nothing reported yet", which is deliberately distinct from
  // the `null` of "no slot selected". Seeded with null, a FRESH mount computed
  // v === null === lastSel and returned early, so onSelect(null) never fired and the
  // parent kept the slot picked during a previous mount — tap "+" on a new day and
  // the create sheet opened pre-filled with a time chosen on some other date, with
  // nothing on screen explaining where it came from. (Changing day mid-mount was
  // already fine: box goes non-null → null, which does differ from lastSel.)
  const lastSel = useRef(undefined)
  useEffect(() => {
    const v = box ? `${hhmm(box.start)}-${hhmm(box.end)}` : null
    if (v === lastSel.current) return
    lastSel.current = v
    onSelect && onSelect(box ? { start: hhmm(box.start), end: hhmm(box.end) } : null)
  }, [box]) // eslint-disable-line react-hooks/exhaustive-deps

  // Snap to 30-min increments so selected times always exist in the create/edit
  // dropdowns (TIME_SLOTS is :00/:30 only). 15-min snapping produced :15/:45
  // values the pickers couldn't represent — the root of the "30-min" glitch.
  const yToMin = (clientY) => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return DAY_START * 60
    const m = DAY_START * 60 + Math.round(((clientY - rect.top) / DAY_PX) * 60 / 30) * 30
    return Math.max(DAY_START * 60, Math.min(DAY_END * 60, m))
  }
  const tapGrid = (e) => {
    if (dragHandle.current) return
    if (!onConfirm) return   // read-only (viewer / signed out): no dead selection box
    const start = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60, yToMin(e.clientY)))
    setBox({ start, end: Math.min(DAY_END * 60, start + 60) }); haptic()
  }

  useEffect(() => {
    const move = (ev) => {
      if (!dragHandle.current) return
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY
      const m = yToMin(cy)
      setBox(b => {
        if (!b) return b
        if (dragHandle.current === 'top') return { ...b, start: Math.min(m, b.end - 30) }
        return { ...b, end: Math.max(m, b.start + 30) }
      })
      ev.preventDefault()
    }
    const up = () => { dragHandle.current = null }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    window.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', up)
    return () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up)
    }
  }, [])

  // Open at the working day, not midnight: other days land on 8 AM; today lands
  // on the current hour so the now-line is in view — but never earlier than 8
  // (at 1 AM you're planning the morning, not staring at the small hours).
  useEffect(() => {
    scrollToHour(gridRef.current, isToday ? Math.max(8, new Date().getHours()) : 8, DAY_PX)
  }, [cursor]) // eslint-disable-line

  const overlapping = box ? dayEvents.filter(e => evMins(e.start) < box.end && evMins(e.end) > box.start && e.status !== 'cancelled') : []
  const laidEvents = layoutOverlaps(dayEvents)
  const now = new Date()
  const nowTop = ((now.getHours() - DAY_START) + now.getMinutes() / 60) * DAY_PX

  // The confirm bar sits BELOW the scrolling grid in normal flow, not floating
  // over it. As a fixed overlay it covered any slot picked near the bottom of the
  // day — pick 8–9 PM and the bar landed exactly on your own selection.
  return (
    <div className="v-daygrid">
      <div className="v-gridwrap" ref={wrapRef}>
      <div className="v-grid" ref={gridRef} style={{ height: (DAY_END - DAY_START) * DAY_PX }}>
        {hours.map(h => <div key={h} className="v-hour" style={{ height: DAY_PX }}><span className="v-hour__label">{format(new Date().setHours(h, 0), 'h a')}</span></div>)}
        <div className="v-grid__col" onClick={tapGrid}>
          {laidEvents.map(({ e, col, cols }) => {
            const s = parseISO(e.start), en = parseISO(e.end)
            const { top, height: h, clipped } = clampBand(s, en, DAY_PX)
            const cancelled = e.status === 'cancelled'
            const bg = eventColor(e)
            return (
              <div key={e.id + e.start} className="v-event"
                style={{
                  top, height: h,
                  left: `calc(${(col / cols) * 100}% + 2px)`,
                  width: `calc(${100 / cols}% - 4px)`,
                  right: 'auto',
                  // Option A: pale wash + full-hue left bar (see CalendarV3 WeekView)
                  background: cancelled ? 'var(--surface-2)' : `color-mix(in srgb, ${bg} 14%, var(--surface))`,
                  borderLeft: cancelled ? '3px solid var(--text-3)' : `3px solid ${bg}`,
                  color: cancelled ? 'var(--text-3)' : 'var(--text)',
                  opacity: cancelled ? 0.7 : 1,
                }}
                title={clipped ? `${e.title} — ${format(s, 'h:mm a')}–${format(en, 'h:mm a')} (outside 8 AM–9 PM)` : e.title}
                onClick={(ev) => { ev.stopPropagation(); onEventTap && onEventTap(e) }}>
                {h > 12 && <div className="v-event__t">{e.is_recurring && !e.is_exception && '↺ '}{e.title}</div>}
                {h > 34 && cols < 3 && <div className="v-event__time">{format(s, 'h:mm')}–{format(en, 'h:mm a')}</div>}
              </div>
            )
          })}

          {box && (
            <div className="v-selbox" style={{ top: ((box.start - DAY_START * 60) / 60) * DAY_PX, height: ((box.end - box.start) / 60) * DAY_PX }}
              onClick={(e) => e.stopPropagation()}>
              <div className="v-selbox__handle v-selbox__handle--top" onMouseDown={() => { dragHandle.current = 'top'; setDragged(true) }} onTouchStart={() => { dragHandle.current = 'top'; setDragged(true) }} />
              <div className="v-selbox__label">{t12(box.start)} – {t12(box.end)}</div>
              <div className="v-selbox__handle v-selbox__handle--bot" onMouseDown={() => { dragHandle.current = 'bot'; setDragged(true) }} onTouchStart={() => { dragHandle.current = 'bot'; setDragged(true) }} />
            </div>
          )}

          {isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * DAY_PX && <div className="v-nowline" style={{ top: nowTop, left: 0 }} />}
        </div>
      </div>
      </div>

      {/* the tap-to-pick hint only makes sense when tapping can lead somewhere;
          side padding keeps it clear of the floating + button */}
      {/* no "tap a time" hint — tapping the grid is the obvious move; let people
          explore (owner's call, 2026-07-24) */}

      {box && (
        <div className="v-selbar">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{t12(box.start)} – {t12(box.end)}</div>
            {/* Only speak up when there IS a clash. "Slot is free" restated what the
                empty grid already showed — the selection sits in visible whitespace —
                so it was a line of text per selection that carried nothing.
                The "drag handles to adjust" half is NOT dropped with it: that is the
                only place the drag affordance is named, and it survives on its own
                until the first drag, after which it has done its job. */}
            {overlapping.length > 0
              ? <div style={{ color: 'var(--warn)', fontSize: '0.8rem' }}>⚠ Clashes with {overlapping.map(e => e.title).join(', ')}</div>
              : !dragged && <div className="m-muted" style={{ fontSize: '0.8rem' }}>Drag handles to adjust</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
            <button className="v-iconbtn" onClick={() => setBox(null)} aria-label="Cancel"><X size={18} /></button>
            {onConfirm && <Btn variant="primary" onClick={() => onConfirm(hhmm(box.start), hhmm(box.end))}>{confirmLabel}</Btn>}
          </div>
        </div>
      )}
    </div>
  )
}
