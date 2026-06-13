import React, { useEffect, useState, useCallback, useRef } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PageHeader, Spinner, Card, Btn, Modal, Badge } from '../components/ui'
import { CreateEventModal } from './DashboardPage'
import {
  format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks,
  isSameDay, parseISO
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Trash2, Move } from 'lucide-react'

const HOUR_START  = 7
const HOUR_END    = 24
const HOURS       = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START)
const CELL_HEIGHT = 60

// ── Composite key — unique per calendar block ─────────────────
// Recurring events share the same id but have different start times.
// Combining id + start gives a key that is unique per visible block.
// All drag/resize operations use this key, never id alone.
// This is the fix for events vanishing when dragging recurring occurrences.
function makeKey(evt) {
  return `${evt.id}__${evt.start}`
}

const EVENT_COLORS = [
  { bg: 'rgba(91,110,245,0.18)',  border: '#5b6ef5', text: '#7b8bff' },
  { bg: 'rgba(52,211,153,0.15)',  border: '#34d399', text: '#2dd4bf' },
  { bg: 'rgba(251,191,36,0.15)',  border: '#fbbf24', text: '#f59e0b' },
  { bg: 'rgba(167,139,250,0.15)', border: '#a78bfa', text: '#c4b5fd' },
  { bg: 'rgba(248,113,113,0.15)', border: '#f87171', text: '#fca5a5' },
]

function getColor(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return EVENT_COLORS[Math.abs(h) % EVENT_COLORS.length]
}

export default function CalendarPage() {
  const { user }  = useAuthStore()
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [events, setEvents]         = useState([])   // server truth with keys
  const [localEvts, setLocalEvts]   = useState([])   // optimistic UI with keys
  const [loading, setLoading]       = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [resources, setResources]   = useState([])
  const [selected, setSelected]     = useState(null)
  const [dragErr, setDragErr]       = useState('')
  const [saving, setSaving]         = useState(null) // composite key of block being saved
  const [moveReq, setMoveReq]       = useState(null) // {eventId,start,end,venues} when a drag hits a taken slot

  // Refs for drag/resize — not state because mouse handlers
  // need current values without stale closures
  const dragging = useRef(null)
  const resizing = useRef(null)
  const gridRef  = useRef(null)

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const days    = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today   = new Date()

  // ── Fetch ──────────────────────────────────────────────────
  const fetchEvents = useCallback(() => {
    setLoading(true)
    api.get('/events/calendar', {
      params: { start: weekStart.toISOString(), end: weekEnd.toISOString() }
    })
      .then(r => {
        // Attach composite key to every event on arrival
        // const withKeys = r.data.map(evt => ({ ...evt, key: makeKey(evt) }))
          const withKeys = r.data.map(evt => ({
          ...evt,
          key: makeKey(evt),
          // For exceptions: occurrence_date is the original RRULE slot (original_time)
          // For normal recurring occurrences: occurrence_date is start itself
          // This is what we send as occurrence_date when editing/dragging
          occurrenceDate: evt.original_time || evt.start,
          }))
        setEvents(withKeys)
        setLocalEvts(withKeys)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [weekStart])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => {
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
  }, [])

  // ── Grid helpers ───────────────────────────────────────────
  const getDayAndMinutes = useCallback((clientX, clientY) => {
    const grid = gridRef.current
    if (!grid) return null
    const rect     = grid.getBoundingClientRect()
    const relX     = clientX - rect.left
    const relY     = clientY - rect.top
    const dayWidth = rect.width / 7
    const dayIndex = Math.max(0, Math.min(6, Math.floor(relX / dayWidth)))
    const minutes  = Math.round((relY / CELL_HEIGHT) * 60)
    return { dayIndex, minutes }
  }, [])

  // ── Drag start — only from the move handle ─────────────────
  // Intentional drag: user must click the ⠿ handle in the top-left.
  // Clicking anywhere else on the event block does NOT trigger drag.
  const handleDragStart = (e, evt) => {
    if (evt.status === 'cancelled') return
    e.preventDefault()
    e.stopPropagation()
    const startDt    = parseISO(evt.start)
    const pos        = getDayAndMinutes(e.clientX, e.clientY)
    if (!pos) return
    const eventTopMins = (startDt.getHours() - HOUR_START) * 60 + startDt.getMinutes()
    dragging.current = {
      key:            evt.key,
      eventId:        evt.id,
      origStart:      evt.start,       // current display time (for snap-back)
      origEnd:        evt.end,
      isRecurring:    !!evt.is_recurring,
      occurrenceDate: evt.occurrenceDate,  // ← the stable original RRULE slot
      offsetMins:     pos.minutes - eventTopMins,
    }
  }

  // ── Resize start — only from the resize handle ─────────────
  // Intentional resize: user must click the handle at the bottom.
  const handleResizeStart = (e, evt) => {
    if (evt.status === 'cancelled') return
    e.preventDefault()
    e.stopPropagation()
    resizing.current = {
      key:            evt.key,
      eventId:        evt.id,
      origStart:      evt.start,
      origEnd:        evt.end,
      isRecurring:    !!evt.is_recurring,
      occurrenceDate: evt.occurrenceDate,  // ← stable original RRULE slot
    }
  }

  // ── Mouse move ─────────────────────────────────────────────
  const handleMouseMove = useCallback(e => {
    if (!dragging.current && !resizing.current) return
    const pos = getDayAndMinutes(e.clientX, e.clientY)
    if (!pos) return

    if (dragging.current) {
      const { key, origStart, origEnd, offsetMins } = dragging.current
      const duration = parseISO(origEnd) - parseISO(origStart)
      const day      = days[pos.dayIndex]

      const rawMins   = pos.minutes - offsetMins
      const snapMins  = Math.round(rawMins / 15) * 15
      const clampMins = Math.max(0, Math.min((HOUR_END - HOUR_START) * 60 - 30, snapMins))

      const newStart = new Date(day)
      newStart.setHours(HOUR_START, 0, 0, 0)
      newStart.setMinutes(newStart.getMinutes() + clampMins)
      const newEnd = new Date(newStart.getTime() + duration)

      // key match — updates exactly this one block
      // For recurring events with shared id, this is critical:
      // only the dragged occurrence moves, others stay in place
      setLocalEvts(prev => prev.map(ev =>
        ev.key === key
          ? { ...ev, start: newStart.toISOString(), end: newEnd.toISOString() }
          : ev
      ))
    }

    if (resizing.current) {
      const { key, origStart } = resizing.current
      const evt = localEvts.find(ev => ev.key === key)
      if (!evt) return

      const base = new Date(days[pos.dayIndex])
      base.setHours(HOUR_START, 0, 0, 0)

      const snapMins = Math.round(pos.minutes / 15) * 15
      const newEnd   = new Date(base.getTime() + snapMins * 60 * 1000)
      const minEnd   = new Date(parseISO(origStart).getTime() + 30 * 60 * 1000)

      if (newEnd > minEnd) {
        setLocalEvts(prev => prev.map(ev =>
          ev.key === key
            ? { ...ev, end: newEnd.toISOString() }
            : ev
        ))
      }
    }
  }, [localEvts, getDayAndMinutes, days])

  // Drag landed on a taken slot → look up who holds it and offer a release request
  const offerRequest = useCallback(async (eventId, start, end) => {
    try {
      const r = await api.get(`/clashes/event/${eventId}`, { params: { start, end } })
      const venues = (r.data || []).flatMap(c => c.venue_bookings || [])
      if (venues.length) { setMoveReq({ eventId, start, end, venues }); return true }
    } catch (e) { /* ignore */ }
    return false
  }, [])

  // ── Mouse up — persist to backend ─────────────────────────
  const handleMouseUp = useCallback(async () => {

    // ── Drag end ───────────────────────────────────────────
    if (dragging.current) {
      // const { key, eventId, origStart, origEnd, isRecurring } = dragging.current
      const {
        key,
        eventId,
        origStart,
        origEnd,
        isRecurring,
        occurrenceDate
      } = dragging.current
      dragging.current = null

      const moved = localEvts.find(ev => ev.key === key)
      if (!moved || (moved.start === origStart && moved.end === origEnd)) return

      setSaving(key)
      setDragErr('')
      try {
        const payload = {
          start_time: moved.start,
          end_time:   moved.end,
        }

        // For recurring events: send occurrence_date = original slot.
        // Backend uses this to create an exception for THIS occurrence only.
        // Without it, backend would update the root event and shift
        // every occurrence in the series.
        if (isRecurring) {
          payload.occurrence_date = occurrenceDate
        }

        await api.patch(`/events/${eventId}`, payload)
        fetchEvents()
     } catch (err) {
        // revert the optimistic move
        setLocalEvts(prev => prev.map(ev =>
          ev.key === key ? { ...ev, start: origStart, end: origEnd } : ev
        ))
        // if the new slot is held by someone, offer to request it (move my event here)
        const offered = err.response?.status === 409
          ? await offerRequest(eventId, moved.start, moved.end)
          : false
        if (!offered) {
          setDragErr(err.response?.data?.detail || `Error ${err.response?.status}`)
          setTimeout(() => setDragErr(''), 8000)
        }
      } finally {
        setSaving(null)
      }
    }

    // ── Resize end ─────────────────────────────────────────
    if (resizing.current) {
      // const { key, eventId, origStart, origEnd, isRecurring } = resizing.current
      const {
        key,
        eventId,
        origStart,
        origEnd,
        isRecurring,
        occurrenceDate
      } = resizing.current
      resizing.current = null

      const resized = localEvts.find(ev => ev.key === key)
      if (!resized || resized.end === origEnd) return

      setSaving(key)
      setDragErr('')
      try {
        const payload = {
          start_time: resized.start,
          end_time:   resized.end,
        }

        if (isRecurring) {
          payload.occurrence_date = occurrenceDate
        }

        await api.patch(`/events/${eventId}`, payload)
        fetchEvents()
      } catch (err) {
        setLocalEvts(prev => prev.map(ev =>
          ev.key === key ? { ...ev, start: origStart, end: origEnd } : ev
        ))
        const offered = err.response?.status === 409
          ? await offerRequest(eventId, resized.start, resized.end)
          : false
        if (!offered) {
          setDragErr(err.response?.data?.detail || 'Could not save — conflict or permission error')
          setTimeout(() => setDragErr(''), 4000)
        }
      } finally {
        setSaving(null)
      }
    }
  }, [localEvts, fetchEvents, offerRequest])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup',   handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ── Event click — fetch full detail ───────────────────────
  const handleEventClick = async (e, evt) => {
    e.stopPropagation()
    if (dragging.current || resizing.current) return
    try {
      const res = await api.get(`/events/${evt.id}`)
      // Attach occurrence context so modal can cancel/edit correctly
      setSelected({
        ...res.data,
        origStart:    evt.start,
        is_recurring: evt.is_recurring,
        is_exception: evt.is_exception,
      })
    } catch {
      setSelected({ ...evt, origStart: evt.start })
    }
  }

  // ── Cancel one occurrence ──────────────────────────────────
  const handleCancelOccurrence = async (eventId, origStart) => {
    try {
      await api.post(`/events/${eventId}/cancel`, { occurrence_date: origStart })
      setSelected(null)
      fetchEvents()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to cancel occurrence')
    }
  }

  // ── Cancel one-off event ───────────────────────────────────
  const handleCancelEvent = async (eventId) => {
    try {
      await api.post(`/events/${eventId}/cancel`, {})
      setSelected(null)
      fetchEvents()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to cancel event')
    }
  }

  // ── Delete entire recurring series ─────────────────────────
  const handleDeleteSeries = async (eventId) => {
    try {
      await api.delete(`/events/${eventId}/series`)
      setSelected(null)
      fetchEvents()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete series')
    }
  }

  const getEventsForDay = day =>
    localEvts.filter(e => isSameDay(parseISO(e.start), day))

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Use the handle to drag · Bottom bar to resize · Click for details"
        action={
          <Btn onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Event
          </Btn>
        }
      />

      {dragErr && <div className="drag-error-toast">⚠ {dragErr}</div>}

      <Card style={{ overflow: 'hidden', padding: 0 }}>
        {/* Nav */}
        <div className="cal-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="cal-nav-btn" onClick={() => setWeekStart(w => subWeeks(w, 1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="cal-nav-label">
              {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
            </span>
            <button className="cal-nav-btn" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="cal-today-btn"
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            >
              Today
            </button>
            {loading && <Spinner size={16} />}
          </div>
        </div>

        {/* Day headers */}
        <div className="cal-grid-header">
          <div className="cal-time-gutter" />
          {days.map(day => (
            <div
              key={day.toISOString()}
              className={`cal-day-header ${isSameDay(day, today) ? 'cal-day-header--today' : ''}`}
            >
              <span className="cal-day-name">{format(day, 'EEE')}</span>
              <span className={`cal-day-num ${isSameDay(day, today) ? 'cal-day-num--today' : ''}`}>
                {format(day, 'd')}
              </span>
            </div>
          ))}
        </div>

        {/* Time grid */}
        <div className="cal-scroll">
          <div className="cal-body-wrap">
            <div className="cal-time-gutter-col">
              {HOURS.map(h => (
                <div key={h} className="cal-time-label" style={{ height: CELL_HEIGHT }}>
                  {format(new Date().setHours(h, 0), 'h a')}
                </div>
              ))}
            </div>

            <div
              className="cal-days-area"
              ref={gridRef}
              style={{ minHeight: (HOUR_END - HOUR_START) * CELL_HEIGHT }}
            >
              {HOURS.map(h => (
                <div key={h} className="cal-hour-line"
                  style={{ top: (h - HOUR_START) * CELL_HEIGHT }} />
              ))}
              {HOURS.map(h => (
                <div key={`${h}h`} className="cal-half-line"
                  style={{ top: (h - HOUR_START) * CELL_HEIGHT + CELL_HEIGHT / 2 }} />
              ))}
              {days.map((_, i) => (
                <div key={i} className="cal-day-sep"
                  style={{ left: `${(i / 7) * 100}%` }} />
              ))}

              {/* Current time line */}
              {days.some(d => isSameDay(d, today)) && (() => {
                const now      = new Date()
                const todayIdx = days.findIndex(d => isSameDay(d, now))
                if (todayIdx < 0) return null
                const topPx = (now.getHours() - HOUR_START + now.getMinutes() / 60) * CELL_HEIGHT
                return (
                  <div className="cal-now-line" style={{
                    top:   topPx,
                    left:  `${(todayIdx / 7) * 100}%`,
                    width: `${(1 / 7) * 100}%`,
                  }} />
                )
              })()}

              {/* Event blocks */}
              {days.map((day, dayIdx) =>
                getEventsForDay(day).map(evt => {
                  const startDt      = parseISO(evt.start)
                  const endDt        = parseISO(evt.end)
                  const topPx        = (startDt.getHours() - HOUR_START + startDt.getMinutes() / 60) * CELL_HEIGHT
                  const heightPx     = Math.max(28, ((endDt - startDt) / 3600000) * CELL_HEIGHT)
                  const color        = getColor(evt.id)
                  const isCancelled  = evt.status === 'cancelled'
                  const isSavingThis = saving === evt.key

                  return (
                    <div
                      key={evt.key}                      // unique per block
                      className={`cal-event-block
                        ${isCancelled  ? 'cal-event-block--cancelled' : ''}
                        ${isSavingThis ? 'cal-event-block--saving'    : ''}
                        ${evt.is_recurring && !evt.is_exception ? 'cal-event-block--recurring' : ''}
                        ${evt.is_exception ? 'cal-event-block--exception' : ''}
                      `}
                      style={{
                        top:        topPx,
                        left:       `calc(${(dayIdx / 7) * 100}% + 2px)`,
                        width:      `calc(${(1 / 7) * 100}% - 4px)`,
                        height:     heightPx,
                        background: isCancelled ? 'rgba(100,100,100,0.1)' : color.bg,
                        borderLeft: `3px solid ${isCancelled ? 'var(--text3)' : color.border}`,
                        color:      isCancelled ? 'var(--text3)' : color.text,
                        cursor:     'default',           // whole block: default cursor
                      }}
                      onClick={e => handleEventClick(e, evt)}
                      title={`${evt.title}${evt.is_recurring ? ' (recurring)' : ''} — click for details`}
                    >
                      {/* ── Move handle — drag only from here ── */}
                      {!isCancelled && (
                        <div
                          className="cal-event-block__move-handle"
                          onMouseDown={e => handleDragStart(e, evt)}
                          onClick={e => e.stopPropagation()}
                          title="Drag to move"
                        >
                          <Move size={10} />
                        </div>
                      )}

                      {/* ── Content ── */}
                      <span className="cal-event-block__title">
                        {evt.is_recurring && !evt.is_exception && '↺ '}
                        {evt.is_exception && '✎ '}
                        {isCancelled && '✕ '}
                        {evt.title}
                      </span>

                      {heightPx > 36 && (
                        <span className="cal-event-block__time">
                          {format(startDt, 'h:mm')}–{format(endDt, 'h:mm a')}
                        </span>
                      )}

                      {isSavingThis && (
                        <span className="cal-event-block__saving">saving…</span>
                      )}

                      {/* ── Resize handle — resize only from here ── */}
                      {!isCancelled && (
                        <div
                          className="cal-event-block__resize"
                          onMouseDown={e => handleResizeStart(e, evt)}
                          onClick={e => e.stopPropagation()}
                          title="Drag to resize"
                        />
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </Card>

      {selected && (
        <EventDetailModal
          event={selected}
          isAdmin={user?.role === 'admin'}
          onClose={() => setSelected(null)}
          onCancelOccurrence={handleCancelOccurrence}
          onCancelEvent={handleCancelEvent}
          onDeleteSeries={handleDeleteSeries}
          onUpdated={() => { setSelected(null); fetchEvents() }}
        />
      )}

      <CreateEventModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        resources={resources}
        onCreated={() => { setShowCreate(false); fetchEvents() }}
      />

      <MoveRequestModal data={moveReq} onClose={() => setMoveReq(null)} />
    </div>
  )
}

// ── "Slot taken → request it" modal (when you drag onto a held slot) ───
function MoveRequestModal({ data, onClose }) {
  const [sent, setSent] = useState({})
  useEffect(() => { setSent({}) }, [data])
  if (!data) return null
  const send = async (vb) => {
    try {
      await api.post('/release-requests', {
        booking_id: vb.booking_id,
        message: '',
        proposed_event: {
          move_event_id: data.eventId,
          start_time: data.start,
          end_time: data.end,
        },
      })
      setSent(s => ({ ...s, [vb.booking_id]: true }))
    } catch (e) { /* ignore */ }
  }
  return (
    <Modal open title="That slot is taken — request it?" onClose={onClose} width={460}>
      <p style={{ fontSize: '0.85rem', opacity: 0.8, margin: '0 0 0.75rem' }}>
        Send a request to move your event here. If the holder accepts, your event is moved into
        this slot automatically.
      </p>
      {data.venues.map(vb => (
        <div key={vb.booking_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' }}>
          <span style={{ fontSize: '0.9rem' }}>
            Room <strong>{vb.resource_name}</strong> · held by {vb.holder_name}
          </span>
          {sent[vb.booking_id]
            ? <em style={{ color: '#15803d' }}>sent ✓</em>
            : <Btn onClick={() => send(vb)}>Send request</Btn>}
        </div>
      ))}
      <div className="form-actions">
        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  )
}

// ── Event Detail Modal ────────────────────────────────────────
function EventDetailModal({
  event: e, isAdmin, onClose,
  onCancelOccurrence, onCancelEvent, onDeleteSeries, onUpdated
}) {
  const canAct      = (isAdmin || e.is_mine) && e.status !== 'cancelled'
  const isRecurring = !!e.is_recurring

  return (
    <Modal open title={e.title} onClose={onClose} width={480}>
      <div className="detail-grid">

        {e.description && (
          <div className="detail-row">
            <span className="detail-label">About</span>
            <span className="detail-value">{e.description}</span>
          </div>
        )}

        <div className="detail-row">
          <span className="detail-label">Status</span>
          <span className="detail-value">
            <Badge label={e.status} type={e.status} />
            {isRecurring && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--accent2)' }}>
                ↺ Recurring
              </span>
            )}
            {e.is_exception && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--yellow)' }}>
                ✎ Edited occurrence
              </span>
            )}
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Start</span>
          <span className="detail-value">
            {format(parseISO(e.start_time || e.origStart), 'EEEE, MMM d yyyy · h:mm a')}
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">End</span>
          <span className="detail-value">
            {format(parseISO(e.end_time || e.origStart), 'h:mm a')}
          </span>
        </div>

        {e.organizer_name && (
          <div className="detail-row">
            <span className="detail-label">Organizer</span>
            <span className="detail-value">{e.organizer_name}</span>
          </div>
        )}

        {isRecurring && e.rrule && (
          <div className="detail-row">
            <span className="detail-label">Schedule</span>
            <span className="detail-value" style={{ fontSize: '0.8rem', color: 'var(--text3)', fontFamily: 'monospace' }}>
              {e.rrule}
            </span>
          </div>
        )}

        {e.bookings?.length > 0 && (
          <div className="detail-row">
            <span className="detail-label">Resources</span>
            <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {e.bookings.map(b => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>{b.resource_name}</span>
                  <Badge label={b.status} type={b.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="detail-row">
          <span className="detail-label">Visibility</span>
          <span className="detail-value">{e.is_public ? 'Public' : 'Private'}</span>
        </div>

      </div>

      {/* Actions */}
      {canAct && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>

          {isRecurring ? (
            <>
              {/* Cancel this specific occurrence only */}
              <Btn
                variant="danger"
                onClick={() => {
                  if (window.confirm('Cancel this occurrence only?\nAll other occurrences will continue as normal.')) {
                    onCancelOccurrence(e.id, e.origStart)
                  }
                }}
              >
                <Trash2 size={14} /> Cancel This Occurrence
              </Btn>

              {/* Delete entire series — separate explicit action */}
              <Btn
                variant="ghost"
                style={{ borderColor: 'rgba(248,113,113,0.3)', color: 'var(--red)' }}
                onClick={() => {
                  if (window.confirm('Delete the ENTIRE recurring series?\nThis will cancel all past and future occurrences and cannot be undone.')) {
                    onDeleteSeries(e.id)
                  }
                }}
              >
                <Trash2 size={14} /> Delete Entire Series
              </Btn>
            </>
          ) : (
            /* Normal one-off event cancel */
            <Btn
              variant="danger"
              onClick={() => {
                if (window.confirm('Cancel this event and all its bookings?')) {
                  onCancelEvent(e.id)
                }
              }}
            >
              <Trash2 size={14} /> Cancel Event
            </Btn>
          )}

        </div>
      )}
    </Modal>
  )
}
