import React, { useEffect, useState, useCallback, useRef } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PageHeader, Spinner, Card, Btn, Modal, Badge } from '../components/ui'
import { CreateEventModal } from './DashboardPage'
import {
  format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks,
  isSameDay, parseISO
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Clock, MapPin, User } from 'lucide-react'

const HOUR_START  = 7
const HOUR_END    = 21
const HOURS       = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i + HOUR_START)
const CELL_HEIGHT = 60   // px per hour

function snapToMinutes(dt, snap = 15) {
  const ms = snap * 60 * 1000
  return new Date(Math.round(dt.getTime() / ms) * ms)
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
  const [events, setEvents]       = useState([])      // server truth
  const [localEvts, setLocalEvts] = useState([])      // optimistic UI
  const [loading, setLoading]     = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [resources, setResources]   = useState([])
  const [selected, setSelected]     = useState(null)  // event detail modal
  const [dragErr, setDragErr]       = useState('')
  const [saving, setSaving]         = useState(null)  // eventId being saved

  // drag state
  const dragging = useRef(null)  // { eventId, offsetMinutes }
  const resizing = useRef(null)  // { eventId }
  const gridRef  = useRef(null)

  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
  const days    = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today   = new Date()

  // ── Fetch ────────────────────────────────────────────────────
  const fetchEvents = useCallback(() => {
    setLoading(true)
    api.get('/events/calendar', {
      params: { start: weekStart.toISOString(), end: weekEnd.toISOString() }
    })
      .then(r => { setEvents(r.data); setLocalEvts(r.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [weekStart])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => {
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
  }, [])

  // ── Grid helpers ─────────────────────────────────────────────
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

  // ── Mouse events ─────────────────────────────────────────────
  const handleDragStart = (e, evt) => {
    if (evt.status === 'cancelled') return
    e.preventDefault()
    e.stopPropagation()
    const startDt     = parseISO(evt.start)
    const offsetMins  = (startDt.getHours() - HOUR_START) * 60 + startDt.getMinutes()
    const pos         = getDayAndMinutes(e.clientX, e.clientY)
    if (!pos) return
    dragging.current = {
      eventId:      evt.id,
      offsetMins:   pos.minutes - offsetMins,
      origStart:    evt.start,
      origEnd:      evt.end,
    }
  }

  const handleResizeStart = (e, evt) => {
    if (evt.status === 'cancelled') return
    e.preventDefault()
    e.stopPropagation()
    resizing.current = { 
      eventId:   evt.id, 
      origEnd:   evt.end, 
      origStart: evt.start    // ← make sure this line exists
    }
  }

  const handleMouseMove = useCallback(e => {
    if (!dragging.current && !resizing.current) return
    const pos = getDayAndMinutes(e.clientX, e.clientY)
    if (!pos) return

    if (dragging.current) {
      const { eventId, offsetMins, origStart, origEnd } = dragging.current
      const evt      = localEvts.find(ev => ev.id === eventId)
      if (!evt) return
      const duration = parseISO(origEnd) - parseISO(origStart)
      const day      = days[pos.dayIndex]

      const rawMins    = pos.minutes - offsetMins
      const snapMins   = Math.round(rawMins / 15) * 15
      const clampMins  = Math.max(0, Math.min((HOUR_END - HOUR_START) * 60 - 30, snapMins))

      const newStart = new Date(day)
      newStart.setHours(HOUR_START, 0, 0, 0)
      newStart.setMinutes(newStart.getMinutes() + clampMins)

      const newEnd = new Date(newStart.getTime() + duration)

      setLocalEvts(prev => prev.map(ev =>
        ev.id === eventId
          ? { ...ev, start: newStart.toISOString(), end: newEnd.toISOString() }
          : ev
      ))
    }

    if (resizing.current) {
      const { eventId, origStart } = resizing.current
      const evt    = localEvts.find(ev => ev.id === eventId)
      if (!evt) return
      const day    = parseISO(evt.start)
      const base   = new Date(day)
      base.setHours(HOUR_START, 0, 0, 0)

      const rawMins  = pos.minutes
      const snapMins = Math.round(rawMins / 15) * 15
      const newEnd   = new Date(base.getTime() + snapMins * 60 * 1000)

      // minimum 30 min
      const minEnd = new Date(parseISO(evt.start).getTime() + 30 * 60 * 1000)
      if (newEnd > minEnd) {
        setLocalEvts(prev => prev.map(ev =>
          ev.id === eventId ? { ...ev, end: newEnd.toISOString() } : ev
        ))
      }
    }
  }, [localEvts, getDayAndMinutes, days])

  const handleMouseUp = useCallback(async () => {
    if (dragging.current) {
      const { eventId, origStart, origEnd } = dragging.current
      dragging.current = null

      const moved = localEvts.find(ev => ev.id === eventId)
      if (!moved || (moved.start === origStart && moved.end === origEnd)) return

      setSaving(eventId)
      setDragErr('')
      try {
        // Find the original event data to check if it's recurring
        const origEvt = events.find(ev => ev.id === eventId && ev.start === origStart)
        
        const payload = {
          start_time: moved.start,
          end_time:   moved.end,
        }

        // If this is a recurring event, pass occurrence_date
        // so the backend knows to edit only THIS occurrence
        // not the entire series
        // occurrence_date = the original slot being replaced
        if (origEvt?.is_recurring) {
          payload.occurrence_date = origStart
        }

        await api.patch(`/events/${eventId}`, payload)
        fetchEvents()
      } catch (err) {
        // Snap back
        setLocalEvts(prev => prev.map(ev =>
          ev.id === eventId ? { ...ev, start: origStart, end: origEnd } : ev
        ))
        const msg = err.response?.data?.detail || 'Could not save — conflict or permission error'
        setDragErr(msg)
        setTimeout(() => setDragErr(''), 4000)
      } finally {
        setSaving(null)
      }
    }

    if (resizing.current) {
      const { eventId, origStart, origEnd } = resizing.current
      resizing.current = null

      const resized = localEvts.find(ev => ev.id === eventId)
      if (!resized || resized.end === origEnd) return

      setSaving(eventId)
      setDragErr('')
      try {
        const origEvt = events.find(ev => ev.id === eventId && ev.start === origStart)

        const payload = {
          start_time: resized.start,
          end_time:   resized.end,
        }

        // Same logic for resize — recurring events edit one occurrence only
        if (origEvt?.is_recurring) {
          payload.occurrence_date = origStart
        }

        await api.patch(`/events/${eventId}`, payload)
        fetchEvents()
      } catch (err) {
        setLocalEvts(prev => prev.map(ev =>
          ev.id === eventId ? { ...ev, start: origStart, end: origEnd } : ev
        ))
        const msg = err.response?.data?.detail || 'Could not save — conflict or permission error'
        setDragErr(msg)
        setTimeout(() => setDragErr(''), 4000)
      } finally {
        setSaving(null)
      }
    }
  }, [localEvts, events, fetchEvents])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup',   handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup',   handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  // ── Event click — fetch full detail ──────────────────────────
  const handleEventClick = async (e, evt) => {
    e.stopPropagation()
    if (dragging.current || resizing.current) return
    try {
      const res = await api.get(`/events/${evt.id}`)
      setSelected(res.data)
    } catch {
      setSelected(evt)
    }
  }

  // ── Cancel event from detail modal ───────────────────────────
  const handleCancelEvent = async (eventId) => {
    try {
      await api.patch(`/events/${eventId}/cancel`)
      setSelected(null)
      fetchEvents()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to cancel event')
    }
  }

  const getEventsForDay = day =>
    localEvts.filter(e => isSameDay(parseISO(e.start), day))

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Drag events to reschedule · Resize to change duration · Click for details"
        action={
          <Btn onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Event
          </Btn>
        }
      />

      {/* Drag error toast */}
      {dragErr && (
        <div className="drag-error-toast">
          ⚠ {dragErr}
        </div>
      )}

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
            {/* Time gutter */}
            <div className="cal-time-gutter-col">
              {HOURS.map(h => (
                <div key={h} className="cal-time-label" style={{ height: CELL_HEIGHT }}>
                  {format(new Date().setHours(h, 0), 'h a')}
                </div>
              ))}
            </div>

            {/* Events area */}
            <div
              className="cal-days-area"
              ref={gridRef}
              style={{
                minHeight: (HOUR_END - HOUR_START) * CELL_HEIGHT,
                cursor: (dragging.current || resizing.current) ? 'grabbing' : 'default',
              }}
            >
              {/* Hour lines */}
              {HOURS.map(h => (
                <div
                  key={h}
                  className="cal-hour-line"
                  style={{ top: (h - HOUR_START) * CELL_HEIGHT }}
                />
              ))}

              {/* Half-hour lines */}
              {HOURS.map(h => (
                <div
                  key={`${h}h`}
                  className="cal-half-line"
                  style={{ top: (h - HOUR_START) * CELL_HEIGHT + CELL_HEIGHT / 2 }}
                />
              ))}

              {/* Day separators */}
              {days.map((_, i) => (
                <div
                  key={i}
                  className="cal-day-sep"
                  style={{ left: `${(i / 7) * 100}%` }}
                />
              ))}

              {/* Current time line */}
              {days.some(d => isSameDay(d, today)) && (() => {
                const now      = new Date()
                const todayIdx = days.findIndex(d => isSameDay(d, now))
                if (todayIdx < 0) return null
                const topPx = (now.getHours() - HOUR_START + now.getMinutes() / 60) * CELL_HEIGHT
                return (
                  <div
                    className="cal-now-line"
                    style={{
                      top:   topPx,
                      left:  `${(todayIdx / 7) * 100}%`,
                      width: `${(1 / 7) * 100}%`,
                    }}
                  />
                )
              })()}

              {/* Event blocks */}
              {days.map((day, dayIdx) => {
                return getEventsForDay(day).map(evt => {
                  const startDt   = parseISO(evt.start)
                  const endDt     = parseISO(evt.end)
                  const topPx     = (startDt.getHours() - HOUR_START + startDt.getMinutes() / 60) * CELL_HEIGHT
                  const heightPx  = Math.max(
                    22,
                    ((endDt - startDt) / 3600000) * CELL_HEIGHT
                  )
                  const color      = getColor(evt.id)
                  const isCancelled = evt.status === 'cancelled'
                  const isSavingThis = saving === evt.id

                  return (
                    <div
                      // key={evt.id}
                      key={`${evt.id}-${evt.start}`}
                      className={`cal-event-block ${isCancelled ? 'cal-event-block--cancelled' : ''} ${isSavingThis ? 'cal-event-block--saving' : ''}`}
                      style={{
                        top:        topPx,
                        left:       `calc(${(dayIdx / 7) * 100}% + 2px)`,
                        width:      `calc(${(1 / 7) * 100}% - 4px)`,
                        height:     heightPx,
                        background: isCancelled ? 'rgba(100,100,100,0.1)' : color.bg,
                        borderLeft: `3px solid ${isCancelled ? 'var(--text3)' : color.border}`,
                        color:      isCancelled ? 'var(--text3)' : color.text,
                        cursor:     isCancelled ? 'pointer' : 'grab',
                      }}
                      onMouseDown={e => e.preventDefault()}
                      onClick={e => handleEventClick(e, evt)}
                      title={`${evt.title} — click for details`}
                    >
                      <span className="cal-event-block__title">
                        {isCancelled && '✕ '}{evt.title}
                      </span>
                      {heightPx > 34 && (
                        <span className="cal-event-block__time">
                          {format(startDt, 'h:mm')}–{format(endDt, 'h:mm a')}
                        </span>
                      )}
                      {isSavingThis && (
                        <span className="cal-event-block__saving">saving…</span>
                      )}
                      {/* Resize handle */}
                      {!isCancelled && (
                        <div
                          className="cal-event-block__resize"
                          onMouseDown={e => handleResizeStart(e, evt)}
                        />
                      )}
                    </div>
                  )
                })
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Event detail modal */}
      {selected && (
        <EventDetailModal
          event={selected}
          currentUserId={user?.user_id}
          isAdmin={user?.role === 'admin'}
          onClose={() => setSelected(null)}
          onCancel={handleCancelEvent}
          onUpdated={() => { setSelected(null); fetchEvents() }}
        />
      )}

      <CreateEventModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        resources={resources}
        onCreated={() => { setShowCreate(false); fetchEvents() }}
      />
    </div>
  )
}

// ── Event Detail Modal ────────────────────────────────────────
function EventDetailModal({ event: e, currentUserId, isAdmin, onClose, onCancel, onUpdated }) {
  const canCancel = (isAdmin || e.is_mine) && e.status !== 'cancelled'
  const isCancelled = e.status === 'cancelled'

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
          <span className="detail-value"><Badge label={e.status} type={e.status} /></span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Start</span>
          <span className="detail-value">
            {format(parseISO(e.start_time || e.start), 'EEEE, MMM d yyyy · h:mm a')}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">End</span>
          <span className="detail-value">
            {format(parseISO(e.end_time || e.end), 'h:mm a')}
          </span>
        </div>
        {e.organizer_name && (
          <div className="detail-row">
            <span className="detail-label">Organizer</span>
            <span className="detail-value">{e.organizer_name}</span>
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

      {canCancel && (
        <div className="form-actions" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <Btn
            variant="danger"
            onClick={() => {
              if (window.confirm('Cancel this event and all its bookings?')) {
                onCancel(e.id)
              }
            }}
          >
            <Trash2 size={14} /> Cancel Event
          </Btn>
        </div>
      )}
    </Modal>
  )
}
