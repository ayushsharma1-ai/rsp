import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, startOfWeek, addMonths, addWeeks, addDays,
  startOfDay, endOfDay, isSameDay, isSameMonth, parseISO,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Btn, DetailRow, useSnack } from '../mobile/ui'
import { TIME_SLOTS, toISO } from '../mobile/lib'
import { haptic } from '../mobile/theme'
import { VENUES, EVENT_COLORS, venueColorForName } from './config'
import { useAutoRefresh } from './useAutoRefresh'
import CreateEventV3 from './CreateEventV3'
import SheetV3 from './SheetV3'

const DAY_START = 7, DAY_END = 22
const DAY_PX = 56, WK_PX = 44
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
const evMins = (iso) => { const d = parseISO(iso); return d.getHours() * 60 + d.getMinutes() }

const venueKeyForName = (name) => {
  if (!name) return 'online'
  const n = (name || '').toLowerCase().replace(/0/g, 'o').replace(/[^a-z0-9]/g, '')
  const v = VENUES.find(x => !x.online && n.includes(x.key.toLowerCase().replace(/0/g, 'o').replace(/[^a-z0-9]/g, '')))
  return v ? v.key : 'other'
}
const colorByVenueKey = (key) => (VENUES.find(v => v.key === key)?.color) || '#64748b'

export function CalendarV3() {
  const { user } = useAuthStore()
  const snack = useSnack()
  const navigate = useNavigate()
  const location = useLocation()
  // View + date live in the URL so browser/hardware back returns to exactly
  // the previous view (week ⇄ month ⇄ day), not some default.
  const [sp, setSp] = useSearchParams()
  const view = sp.get('view') || 'week'               // 'week' | 'month' | 'day'
  // Memo on the param VALUE (not the sp object) so unrelated param changes
  // don't mint a new cursor identity and cascade into event refetches.
  const dParam = sp.get('d')
  const cursor = useMemo(() => {
    if (dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)) {
      const d = new Date(`${dParam}T00:00`)
      if (!isNaN(d)) return startOfDay(d)
    }
    return startOfDay(new Date())                     // malformed/missing → today
  }, [dParam])
  // View changes PUSH history (back undoes them); date stepping REPLACES
  // (back shouldn't crawl through every week you scrolled past).
  const go = useCallback((v, d, push = false) =>
    setSp({ view: v, d: format(d, 'yyyy-MM-dd') }, { replace: !push }), [setSp])
  const setView = (v) => go(v, cursor, true)
  const setCursor = (updater) => go(view, typeof updater === 'function' ? updater(cursor) : updater)
  const [events, setEvents] = useState(null)
  const [venueByEvent, setVenueByEvent] = useState({})
  const [active, setActive] = useState(() => new Set([...VENUES.map(v => v.key), 'other']))
  const [sel, setSel] = useState(null)
  const [create, setCreate] = useState(null)          // {date, start, end}
  const [moving, setMoving] = useState(null)
  const today = startOfDay(new Date())

  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), end: endOfDay(cursor) }
    // Week view is a rolling 7-day window STARTING at the cursor (today by
    // default) — you don't see the past unless you step/scroll back.
    if (view === 'week') return { start: startOfDay(cursor), end: addDays(cursor, 7) }
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    return { start: gridStart, end: addDays(gridStart, 42) }
  }, [view, cursor])

  const loadVenues = useCallback(() => {
    api.get('/bookings').then(r => { const m = {}; r.data.forEach(b => { if (b.event_id) m[b.event_id] = b.resource_name }); setVenueByEvent(m) }).catch(() => {})
  }, [])
  const load = useCallback((silent = false) => {
    if (!silent) setEvents(null)   // background polls don't flash the skeleton
    api.get('/events/calendar', { params: { start: range.start.toISOString(), end: range.end.toISOString() } })
      .then(r => setEvents(r.data.map(e => ({ ...e, occurrenceDate: e.original_time || e.start }))))
      .catch(() => setEvents(prev => prev || []))
  }, [range])
  useEffect(() => { loadVenues() }, [loadVenues])
  useEffect(() => { load() }, [load])
  // Pick up other users' changes without a manual reload (poll + on-focus).
  useAutoRefresh(() => { load(true); loadVenues() }, 25000)

  const eventVenue = (e) => venueKeyForName(venueByEvent[e.id])
  const eventColor = (e) => e.color || venueColorForName(venueByEvent[e.id])
  const visible = (events || []).filter(e => active.has(eventVenue(e)))
  const toggleFilter = (key) => setActive(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  const openDetail = async (e) => {
    haptic()
    try {
      const r = await api.get(`/events/${e.id}`)
      setSel({ ...r.data, blockStart: e.start, blockEnd: e.end, is_recurring: e.is_recurring, is_exception: e.is_exception, occurrenceDate: e.occurrenceDate })
    } catch { setSel({ ...e, blockStart: e.start, blockEnd: e.end }) }
  }
  const cancelEvt = async () => {
    try { await api.post(`/events/${sel.id}/cancel`, sel.is_recurring ? { occurrence_date: sel.blockStart } : {}); snack('Cancelled'); setSel(null); load() }
    catch (e) { snack(e.response?.data?.detail || 'Failed') }
  }
  const deleteSeries = async () => {
    try { await api.delete(`/events/${sel.id}/series`); snack('Series deleted'); setSel(null); load() }
    catch (e) { snack(e.response?.data?.detail || 'Failed') }
  }

  const goDay = (d) => go('day', startOfDay(d), true)
  // Back from Day view = real history back, so you land on whichever view
  // (week or month, at whatever date) you tapped the day from.
  const backFromDay = () => { if (location.key !== 'default') navigate(-1); else go('week', cursor) }
  const stepBack = () => setCursor(c => view === 'day' ? addDays(c, -1) : view === 'week' ? addWeeks(c, -1) : addMonths(c, -1))
  const stepFwd = () => setCursor(c => view === 'day' ? addDays(c, 1) : view === 'week' ? addWeeks(c, 1) : addMonths(c, 1))
  const title = view === 'day' ? format(cursor, 'EEEE, MMM d') : format(cursor, 'MMMM yyyy')

  return (
    <div>
      <div className="v-cal-head">
        <div className="v-cal-title">{title}</div>
        <div className="v-seg">
          <button className={view === 'week' ? 'v-seg--active' : ''} onClick={() => setView('week')}>Week</button>
          <button className={view === 'month' ? 'v-seg--active' : ''} onClick={() => setView('month')}>Month</button>
        </div>
      </div>

      <div className="v-navrow" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <button className="v-iconbtn" onClick={stepBack}><ChevronLeft size={18} /></button>
        <button className="m-chip" onClick={() => setCursor(today)}>Today</button>
        <button className="v-iconbtn" onClick={stepFwd}><ChevronRight size={18} /></button>
      </div>

      {view !== 'week' && (
        <div className="v-filters">
          {VENUES.map(v => {
            const on = active.has(v.key)
            return (
              <button key={v.key} className={`v-filter ${on ? 'v-filter--on' : ''}`} onClick={() => { haptic(); toggleFilter(v.key) }} style={on ? { borderColor: v.color } : {}}>
                <span className="v-filter__dot" style={{ background: on ? v.color : 'var(--text-3)' }} />{v.label}
              </button>
            )
          })}
        </div>
      )}

      {view === 'month' && <MonthView cursor={cursor} today={today} events={visible} eventColor={eventColor} onPick={goDay} />}
      {view === 'week' && <WeekView cursor={cursor} today={today} events={visible} eventColor={eventColor} loading={events === null} onPickDay={goDay} onEvent={openDetail} onPrev={stepBack} onNext={stepFwd} />}
      {view === 'day' && <DayView cursor={cursor} today={today} events={visible} eventColor={eventColor} loading={events === null} onBack={backFromDay}
        onEvent={openDetail} onCreate={(start, end) => setCreate({ date: format(cursor, 'yyyy-MM-dd'), start, end })} />}

      <button className="v-fab" aria-label="New event" onClick={() => { haptic(); if (view !== 'day') goDay(cursor); else setCreate({ date: format(cursor, 'yyyy-MM-dd'), start: '09:00', end: '10:00' }) }}><Plus size={24} /></button>

      <CreateEventV3 open={!!create} onClose={() => setCreate(null)} date={create?.date} start={create?.start} end={create?.end}
        onCreated={() => { setCreate(null); load(); loadVenues() }} />

      <SheetV3 open={!!sel} onClose={() => setSel(null)} title={sel?.title}>
        {sel && (() => {
          const canAct = (user?.role === 'admin' || sel.is_mine) && sel.status !== 'cancelled'
          return (
            <div>
              {sel.description && <p className="m-muted" style={{ marginTop: 0 }}>{sel.description}</p>}
              <DetailRow label="Status" value={sel.status} />
              <DetailRow label="Start" value={format(parseISO(sel.blockStart || sel.start_time), 'EEE MMM d · HH:mm')} />
              <DetailRow label="End" value={format(parseISO(sel.blockEnd || sel.end_time), 'HH:mm')} />
              {sel.organizer_name && <DetailRow label="Organizer" value={sel.organizer_name} />}
              {(sel.bookings || []).length > 0 && <DetailRow label="Venue" value={sel.bookings.map(b => b.resource_name).join(', ')} />}
              {canAct && (
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  <Btn variant="primary" full onClick={() => { setMoving(sel); setSel(null) }}>Edit event</Btn>
                  <Btn full variant="ghost" style={{ color: 'var(--danger)' }} onClick={cancelEvt}>{sel.is_recurring ? 'Cancel this occurrence' : 'Cancel event'}</Btn>
                  {sel.is_recurring && <Btn full variant="ghost" style={{ color: 'var(--danger)' }} onClick={deleteSeries}>Delete entire series</Btn>}
                </div>
              )}
            </div>
          )
        })()}
      </SheetV3>

      <EditSheet event={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load(); loadVenues() }} snack={snack} />
    </div>
  )
}

function MonthView({ cursor, today, events, eventColor, onPick }) {
  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const byDay = {}
  events.forEach(e => { const k = format(parseISO(e.start), 'yyyy-MM-dd'); (byDay[k] = byDay[k] || []).push(e) })
  return (
    <div>
      <div className="v-month__dow">{DOW.map(d => <span key={d}>{d[0]}</span>)}</div>
      <div className="v-month__grid">
        {cells.map(d => {
          const k = format(d, 'yyyy-MM-dd'); const list = byDay[k] || []
          return (
            <button key={k} className={`v-daycell ${!isSameMonth(d, cursor) ? 'v-daycell--outside' : ''} ${isSameDay(d, today) ? 'v-daycell--today' : ''}`} onClick={() => { haptic(); onPick(d) }}>
              <span className="v-daynum">{format(d, 'd')}</span>
              <span className="v-daydots">{list.slice(0, 4).map((e, i) => <i key={i} style={{ background: eventColor(e) }} />)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ cursor, today, events, eventColor, loading, onPickDay, onEvent, onPrev, onNext }) {
  // rolling 7-day window starting at the cursor (today by default)
  const days = Array.from({ length: 7 }, (_, i) => addDays(cursor, i))
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
  const sx = useRef(null)
  const swiped = useRef(false)   // suppress the tap that follows a swipe
  const onTS = (e) => { sx.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; swiped.current = false }
  const onTE = (e) => {
    if (!sx.current) return
    const dx = e.changedTouches[0].clientX - sx.current.x
    const dy = e.changedTouches[0].clientY - sx.current.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { swiped.current = true; haptic(); dx > 0 ? onPrev() : onNext() }
    sx.current = null
  }
  const pick = (d) => { if (!swiped.current) onPickDay(d) }
  return (
    <div onTouchStart={onTS} onTouchEnd={onTE}>
      <div className="v-week__head">
        <div className="v-week__gutter" />
        {days.map(d => (
          <button key={d.toISOString()} className={`v-week__dayhd ${isSameDay(d, today) ? 'v-week__dayhd--today' : ''}`} onClick={() => { haptic(); pick(d) }}>
            <span className="v-week__dow">{format(d, 'EEE')}</span>
            <span className="v-week__num">{format(d, 'd')}</span>
          </button>
        ))}
      </div>
      <div className="v-week__grid" style={{ height: (DAY_END - DAY_START) * WK_PX }}>
        <div className="v-week__gutter">
          {hours.map(h => <div key={h} className="v-week__hlabel" style={{ height: WK_PX }}>{format(new Date().setHours(h, 0), 'ha')}</div>)}
        </div>
        {days.map((d, di) => {
          const list = events.filter(e => isSameDay(parseISO(e.start), d))
          return (
            <div key={di} className="v-week__col" onClick={() => pick(d)} style={{ height: (DAY_END - DAY_START) * WK_PX }}>
              {hours.map(h => <div key={h} className="v-week__line" style={{ top: (h - DAY_START) * WK_PX }} />)}
              {list.map(e => {
                const top = ((evMins(e.start) - DAY_START * 60) / 60) * WK_PX
                const h = Math.max(16, ((parseISO(e.end) - parseISO(e.start)) / 3600000) * WK_PX)
                return (
                  <div key={e.id + e.start} className="v-week__ev" style={{ top, height: h, background: eventColor(e) }}
                    onClick={(ev) => { ev.stopPropagation(); onEvent(e) }} title={e.title}>
                    <span className="v-week__ev-title">{e.title}</span>
                    {h > 30 && <span className="v-week__ev-time">{format(parseISO(e.start), 'HH:mm')}</span>}
                  </div>
                )
              })}
            </div>
          )
        })}
        {loading && <span className="m-spin" style={{ position: 'absolute', right: 6, top: 6 }} />}
      </div>
      <p className="m-muted" style={{ textAlign: 'center', marginTop: 10, fontSize: '0.82rem' }}>Tap a day to open it · swipe ← → for other weeks.</p>
    </div>
  )
}

function DayView({ cursor, today, events, eventColor, loading, onBack, onEvent, onCreate }) {
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
  const dayEvents = events.filter(e => isSameDay(parseISO(e.start), cursor))
  const isToday = isSameDay(cursor, today)
  const gridRef = useRef(null)
  const dragHandle = useRef(null)
  const [box, setBox] = useState(null)   // {start, end} in minutes

  const yToMin = (clientY) => {
    // a queued move event can fire after unmount, when gridRef is already null
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return DAY_START * 60
    let m = DAY_START * 60 + Math.round(((clientY - rect.top) / DAY_PX) * 60 / 15) * 15
    return Math.max(DAY_START * 60, Math.min(DAY_END * 60, m))
  }
  const tapGrid = (e) => {
    if (dragHandle.current) return
    const start = Math.max(DAY_START * 60, Math.min((DAY_END - 1) * 60, yToMin(e.clientY) - 0))
    setBox({ start, end: Math.min(DAY_END * 60, start + 60) })
    haptic()
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

  // clash-on-select: existing events overlapping the selected box
  const overlapping = box ? dayEvents.filter(e => evMins(e.start) < box.end && evMins(e.end) > box.start && e.status !== 'cancelled') : []
  const now = new Date()
  const nowTop = ((now.getHours() - DAY_START) + now.getMinutes() / 60) * DAY_PX

  return (
    <div>
      <div className="v-dayhead">
        <button className="v-iconbtn" style={{ width: 34, height: 34, alignSelf: 'center' }} onClick={() => { haptic(); onBack() }} aria-label="Back to week">
          <ChevronLeft size={18} />
        </button>
        <span className={`v-dayhead__num ${isToday ? 'v-dayhead__num--today' : ''}`}>{format(cursor, 'd')}</span>
        <span style={{ fontWeight: 600 }}>{format(cursor, 'EEEE')}</span>
        {loading && <span className="m-spin" style={{ marginLeft: 'auto' }} />}
      </div>

      <div className="v-grid" ref={gridRef} style={{ height: (DAY_END - DAY_START) * DAY_PX }}>
        {hours.map(h => <div key={h} className="v-hour" style={{ height: DAY_PX }}><span className="v-hour__label">{format(new Date().setHours(h, 0), 'h a')}</span></div>)}
        <div className="v-grid__col" onClick={tapGrid}>
          {dayEvents.map(e => {
            const s = parseISO(e.start), en = parseISO(e.end)
            const top = ((s.getHours() - DAY_START) + s.getMinutes() / 60) * DAY_PX
            const h = Math.max(24, ((en - s) / 3600000) * DAY_PX)
            const cancelled = e.status === 'cancelled'
            return (
              <div key={e.id + e.start} className="v-event" style={{ top, height: h, background: cancelled ? 'var(--text-3)' : eventColor(e), opacity: cancelled ? 0.5 : 1 }}
                onClick={(ev) => { ev.stopPropagation(); onEvent(e) }}>
                <div className="v-event__t">{e.is_recurring && !e.is_exception && '↺ '}{e.title}</div>
                {h > 34 && <div className="v-event__time">{format(s, 'HH:mm')}–{format(en, 'HH:mm')}</div>}
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

      {!box && <p className="m-muted" style={{ textAlign: 'center', marginTop: 12, fontSize: '0.85rem' }}>Tap a time to start a new event.</p>}

      {/* selection action bar with clash-on-select prompt */}
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
            <Btn variant="primary" onClick={() => onCreate(hhmm(box.start), hhmm(box.end))}>Add event</Btn>
          </div>
        </div>
      )}
    </div>
  )
}

function EditSheet({ event, onClose, onDone, snack }) {
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(null)
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [venues, setVenues] = useState(null)
  const [sent, setSent] = useState({})

  useEffect(() => {
    if (event) {
      setTitle(event.title || '')
      setColor(event.color || null)
      setDate(format(parseISO(event.blockStart || event.start_time), 'yyyy-MM-dd'))
      setStart(format(parseISO(event.blockStart || event.start_time), 'HH:mm'))
      setEnd(format(parseISO(event.blockEnd || event.end_time), 'HH:mm'))
      setError(''); setVenues(null); setSent({})
    }
  }, [event])
  if (!event) return null

  const save = async () => {
    if (!title.trim()) { setError('Title cannot be empty.'); return }
    if (end <= start) { setError('End must be after start.'); return }
    setLoading(true); setError(''); setVenues(null)
    const ns = toISO(date, start), ne = toISO(date, end)
    try {
      const payload = { title: title.trim(), color, start_time: ns, end_time: ne }
      if (event.is_recurring) payload.occurrence_date = event.occurrenceDate
      await api.patch(`/events/${event.id}`, payload); snack('Event updated'); onDone()
    } catch (err) {
      if (err.response?.status === 409) {
        try {
          const r = await api.get(`/clashes/event/${event.id}`, { params: { start: ns, end: ne } })
          const vb = (r.data || []).flatMap(c => c.venue_bookings || [])
          if (vb.length) { setVenues({ list: vb, start: ns, end: ne }); setLoading(false); return }
        } catch { /* ignore */ }
      }
      setError(err.response?.data?.detail || 'That time is busy.')
    } finally { setLoading(false) }
  }
  const requestSlot = async (vb) => {
    try {
      await api.post('/release-requests', { booking_id: vb.booking_id, message: '', proposed_event: { move_event_id: event.id, start_time: venues.start, end_time: venues.end } })
      setSent(s => ({ ...s, [vb.booking_id]: true })); snack('Request sent')
    } catch { snack('Could not send request') }
  }
  const endSlots = TIME_SLOTS.filter(s => s.value > start)

  return (
    <SheetV3 open={!!event} onClose={onClose} title="Edit event">
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label className="m-label">Title</label>
          <input className="m-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" /></div>
        <div><label className="m-label">Date & time</label>
          <input className="m-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="m-input" value={start} onChange={e => setStart(e.target.value)}>{TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            <span style={{ color: 'var(--text-2)' }}>→</span>
            <select className="m-input" value={end} onChange={e => setEnd(e.target.value)}>{endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          </div>
        </div>
        <div><label className="m-label">Color</label>
          <div className="v-swatches">
            <button type="button" className={`v-swatch v-swatch--auto ${color === null ? 'v-swatch--on' : ''}`} onClick={() => { haptic(); setColor(null) }} title="Auto">A</button>
            {EVENT_COLORS.map(c => (
              <button key={c} type="button" className={`v-swatch ${color === c ? 'v-swatch--on' : ''}`} style={{ background: c }} onClick={() => { haptic(); setColor(c) }} />
            ))}
          </div>
        </div>
        {venues && (
          <div className="m-warn">
            <strong>That slot is taken — request it?</strong>
            {venues.list.map(vb => (
              <div key={vb.booking_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6, fontSize: '0.84rem' }}>
                <span>{vb.resource_name} · {vb.holder_name}</span>
                {sent[vb.booking_id] ? <em style={{ color: 'var(--ok)' }}>sent ✓</em> : <button type="button" className="m-link" onClick={() => requestSlot(vb)}>Request</button>}
              </div>
            ))}
          </div>
        )}
        {error && <p className="m-error">{error}</p>}
        {!venues && <Btn variant="primary" full loading={loading} onClick={save}>Save changes</Btn>}
      </div>
    </SheetV3>
  )
}
