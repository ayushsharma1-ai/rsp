import React, { useEffect, useRef, useState } from 'react'
import { format, isSameDay, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import { Btn } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import { readableOn } from './config'
import { DAY_START, DAY_END, DAY_PX, hhmm, evMins, layoutOverlaps } from './dayConsts'

// Find the nearest scrollable ancestor so we can auto-scroll to "now" no matter
// where the grid is mounted (calendar page OR the move-event overlay).
function scrollableAncestor(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

// The touch day grid: time rows, events (overlaps side-by-side), tap+drag to
// pick a slot, "now" line, and a confirm bar. Shared by event-create and
// event-move so both feel identical.
export default function DayGrid({ cursor, today, events, eventColor, confirmLabel = 'Add event', onConfirm, onEventTap, sheetOpen }) {
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
  const dayEvents = (events || []).filter(e => isSameDay(parseISO(e.start), cursor))
  const isToday = isSameDay(cursor, today || new Date())
  const gridRef = useRef(null)
  const dragHandle = useRef(null)
  const [box, setBox] = useState(null)   // { start, end } in minutes

  // clear the selection when an owning sheet closes (create flow passes its open flag)
  useEffect(() => { if (sheetOpen === false) setBox(null) }, [sheetOpen])

  const yToMin = (clientY) => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return DAY_START * 60
    const m = DAY_START * 60 + Math.round(((clientY - rect.top) / DAY_PX) * 60 / 15) * 15
    return Math.max(DAY_START * 60, Math.min(DAY_END * 60, m))
  }
  const tapGrid = (e) => {
    if (dragHandle.current) return
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
        if (dragHandle.current === 'top') return { ...b, start: Math.min(m, b.end - 15) }
        return { ...b, end: Math.max(m, b.start + 15) }
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

  // open at "now" (today) / ~8am, instead of always at 7am
  useEffect(() => {
    const sc = scrollableAncestor(gridRef.current)
    if (!sc) return
    const hour = isToday ? new Date().getHours() : 8
    sc.scrollTo({ top: Math.max(0, (hour - DAY_START - 0.5) * DAY_PX), behavior: 'auto' })
  }, [cursor]) // eslint-disable-line

  const overlapping = box ? dayEvents.filter(e => evMins(e.start) < box.end && evMins(e.end) > box.start && e.status !== 'cancelled') : []
  const laidEvents = layoutOverlaps(dayEvents)
  const now = new Date()
  const nowTop = ((now.getHours() - DAY_START) + now.getMinutes() / 60) * DAY_PX

  return (
    <>
      <div className="v-grid" ref={gridRef} style={{ height: (DAY_END - DAY_START) * DAY_PX }}>
        {hours.map(h => <div key={h} className="v-hour" style={{ height: DAY_PX }}><span className="v-hour__label">{format(new Date().setHours(h, 0), 'h a')}</span></div>)}
        <div className="v-grid__col" onClick={tapGrid}>
          {laidEvents.map(({ e, col, cols }) => {
            const s = parseISO(e.start), en = parseISO(e.end)
            const top = ((s.getHours() - DAY_START) + s.getMinutes() / 60) * DAY_PX
            const h = Math.max(24, ((en - s) / 3600000) * DAY_PX)
            const cancelled = e.status === 'cancelled'
            const bg = eventColor(e)
            return (
              <div key={e.id + e.start} className="v-event"
                style={{
                  top, height: h,
                  left: `calc(${(col / cols) * 100}% + 2px)`,
                  width: `calc(${100 / cols}% - 4px)`,
                  right: 'auto',
                  background: cancelled ? 'var(--surface-2)' : bg,
                  color: cancelled ? 'var(--text-3)' : readableOn(bg),
                  opacity: cancelled ? 0.7 : 1,
                }}
                onClick={(ev) => { ev.stopPropagation(); onEventTap && onEventTap(e) }}>
                <div className="v-event__t">{e.is_recurring && !e.is_exception && '↺ '}{e.title}</div>
                {h > 34 && cols < 3 && <div className="v-event__time">{format(s, 'HH:mm')}–{format(en, 'HH:mm')}</div>}
              </div>
            )
          })}

          {box && (
            <div className="v-selbox" style={{ top: ((box.start - DAY_START * 60) / 60) * DAY_PX, height: ((box.end - box.start) / 60) * DAY_PX }}
              onClick={(e) => e.stopPropagation()}>
              <div className="v-selbox__handle v-selbox__handle--top" onMouseDown={() => { dragHandle.current = 'top' }} onTouchStart={() => { dragHandle.current = 'top' }} />
              <div className="v-selbox__label">{hhmm(box.start)} – {hhmm(box.end)}</div>
              <div className="v-selbox__handle v-selbox__handle--bot" onMouseDown={() => { dragHandle.current = 'bot' }} onTouchStart={() => { dragHandle.current = 'bot' }} />
            </div>
          )}

          {isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * DAY_PX && <div className="v-nowline" style={{ top: nowTop, left: 0 }} />}
        </div>
      </div>

      {!box && <p className="m-muted" style={{ textAlign: 'center', marginTop: 12, fontSize: '0.85rem' }}>Tap a time to pick a slot.</p>}

      {box && (
        <div className="v-selbar">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{hhmm(box.start)} – {hhmm(box.end)}</div>
            {overlapping.length > 0
              ? <div style={{ color: 'var(--warn)', fontSize: '0.8rem' }}>⚠ Clashes with {overlapping.map(e => e.title).join(', ')}</div>
              : <div className="m-muted" style={{ fontSize: '0.8rem' }}>Slot is free · drag handles to adjust</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="v-iconbtn" onClick={() => setBox(null)} aria-label="Cancel"><X size={18} /></button>
            <Btn variant="primary" onClick={() => onConfirm(hhmm(box.start), hhmm(box.end))}>{confirmLabel}</Btn>
          </div>
        </div>
      )}
    </>
  )
}
