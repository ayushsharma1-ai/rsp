import React, { useEffect, useState, useCallback } from 'react'
import { format, startOfDay, endOfDay, addDays, isSameDay, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { ListSkeleton, Empty, Btn, BottomSheet, DetailRow, useSnack } from '../ui'
import { TIME_SLOTS, toISO } from '../lib'
import { haptic } from '../theme'
import EventCreateSheet from '../EventCreateSheet'

const colorFor = (id) => {
  const palette = ['#5b6ef5', '#34d399', '#fbbf24', '#a78bfa', '#f87171']
  let h = 0; for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h)
  return palette[Math.abs(h) % palette.length]
}

export function CalendarScreen() {
  const { user } = useAuthStore()
  const snack = useSnack()
  const [day, setDay] = useState(startOfDay(new Date()))
  const [events, setEvents] = useState(null)
  const [sel, setSel] = useState(null)     // selected event block (detail)
  const [creating, setCreating] = useState(false)
  const [moving, setMoving] = useState(null) // event being moved

  const strip = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i))

  const load = useCallback(() => {
    setEvents(null)
    api.get('/events/calendar', { params: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() } })
      .then(r => setEvents(r.data.map(e => ({ ...e, occurrenceDate: e.original_time || e.start }))
        .sort((a, b) => new Date(a.start) - new Date(b.start))))
      .catch(() => setEvents([]))
  }, [day])
  useEffect(() => { load() }, [load])

  const openDetail = async (evt) => {
    haptic()
    try {
      const r = await api.get(`/events/${evt.id}`)
      setSel({ ...r.data, origStart: evt.start, blockStart: evt.start, blockEnd: evt.end, is_recurring: evt.is_recurring, is_exception: evt.is_exception, occurrenceDate: evt.occurrenceDate })
    } catch { setSel({ ...evt, origStart: evt.start, blockStart: evt.start, blockEnd: evt.end }) }
  }

  const cancelOcc = async () => {
    try {
      await api.post(`/events/${sel.id}/cancel`, sel.is_recurring ? { occurrence_date: sel.origStart } : {})
      snack(sel.is_recurring ? 'Occurrence cancelled' : 'Event cancelled'); setSel(null); load()
    } catch (e) { snack(e.response?.data?.detail || 'Failed') }
  }
  const deleteSeries = async () => {
    try { await api.delete(`/events/${sel.id}/series`); snack('Series deleted'); setSel(null); load() }
    catch (e) { snack(e.response?.data?.detail || 'Failed') }
  }

  const dayEvents = events || []

  return (
    <div>
      {/* Date strip */}
      <div className="m-chips">
        {strip.map(d => {
          const active = isSameDay(d, day)
          return (
            <button key={d.toISOString()} className={`m-datepill ${active ? 'm-datepill--active' : ''}`}
              onClick={() => { haptic(); setDay(startOfDay(d)) }}>
              <span className="m-datepill__dow">{format(d, 'EEE')}</span>
              <span className="m-datepill__num">{format(d, 'd')}</span>
            </button>
          )
        })}
      </div>

      <p className="m-section-title" style={{ marginTop: 4 }}>{format(day, 'EEEE, MMMM d')}</p>

      {events === null ? <ListSkeleton h={72} /> :
        dayEvents.length === 0 ? <Empty icon="📅" text="Nothing scheduled. Tap + to book." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {dayEvents.map(e => (
              <button key={e.id + e.start} className="m-card m-eventrow" style={{ textAlign: 'left', borderLeft: `3px solid ${colorFor(e.id)}` }}
                onClick={() => openDetail(e)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.is_recurring && !e.is_exception && '↺ '}{e.is_exception && '✎ '}{e.status === 'cancelled' && '✕ '}{e.title}
                  </div>
                  <div className="m-muted" style={{ fontSize: '0.82rem' }}>
                    {format(parseISO(e.start), 'HH:mm')} – {format(parseISO(e.end), 'HH:mm')}
                  </div>
                </div>
                <span className="m-badge">{e.status}</span>
              </button>
            ))}
          </div>}

      {/* FAB */}
      <button className="m-fab" onClick={() => { haptic(); setCreating(true) }} aria-label="New event"><Plus size={24} /></button>

      <EventCreateSheet open={creating} onClose={() => setCreating(false)} defaultDate={format(day, 'yyyy-MM-dd')}
        onCreated={() => { setCreating(false); load() }} />

      {/* Detail sheet */}
      <BottomSheet open={!!sel} onClose={() => setSel(null)} title={sel?.title}>
        {sel && (() => {
          const canAct = (user?.role === 'admin' || sel.is_mine) && sel.status !== 'cancelled'
          return (
            <div>
              {sel.description && <p className="m-muted" style={{ marginTop: 0 }}>{sel.description}</p>}
              <DetailRow label="Status" value={sel.status} />
              <DetailRow label="Start" value={format(parseISO(sel.blockStart || sel.start_time), 'EEE MMM d · HH:mm')} />
              <DetailRow label="End" value={format(parseISO(sel.blockEnd || sel.end_time), 'HH:mm')} />
              {sel.organizer_name && <DetailRow label="Organizer" value={sel.organizer_name} />}
              {sel.is_recurring && <DetailRow label="Repeats" value={sel.rrule || 'Recurring'} />}
              {(sel.bookings || []).length > 0 && <DetailRow label="Rooms" value={sel.bookings.map(b => b.resource_name).join(', ')} />}
              <DetailRow label="Visibility" value={sel.is_public ? 'Public' : 'Private'} />

              {canAct && (
                <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                  <Btn full onClick={() => { setMoving(sel); setSel(null) }}>Move event</Btn>
                  <Btn full variant="ghost" style={{ color: 'var(--danger)' }} onClick={cancelOcc}>
                    {sel.is_recurring ? 'Cancel this occurrence' : 'Cancel event'}
                  </Btn>
                  {sel.is_recurring && <Btn full variant="ghost" style={{ color: 'var(--danger)' }} onClick={deleteSeries}>Delete entire series</Btn>}
                </div>
              )}
            </div>
          )
        })()}
      </BottomSheet>

      <MoveSheet event={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load() }} snack={snack} />
    </div>
  )
}

// Move an event to a new time. On 409 (slot held), offer release requests.
function MoveSheet({ event, onClose, onDone, snack }) {
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [venues, setVenues] = useState(null)
  const [sent, setSent] = useState({})

  useEffect(() => {
    if (event) {
      setDate(format(parseISO(event.blockStart || event.start_time), 'yyyy-MM-dd'))
      setStart(format(parseISO(event.blockStart || event.start_time), 'HH:mm'))
      setEnd(format(parseISO(event.blockEnd || event.end_time), 'HH:mm'))
      setError(''); setVenues(null); setSent({})
    }
  }, [event])

  if (!event) return null

  const save = async () => {
    if (end <= start) { setError('End must be after start.'); return }
    setLoading(true); setError(''); setVenues(null)
    const newStart = toISO(date, start), newEnd = toISO(date, end)
    try {
      const payload = { start_time: newStart, end_time: newEnd }
      if (event.is_recurring) payload.occurrence_date = event.occurrenceDate
      await api.patch(`/events/${event.id}`, payload)
      snack('Event moved'); onDone()
    } catch (err) {
      if (err.response?.status === 409) {
        try {
          const r = await api.get(`/clashes/event/${event.id}`, { params: { start: newStart, end: newEnd } })
          const vb = (r.data || []).flatMap(c => c.venue_bookings || [])
          if (vb.length) { setVenues({ list: vb, start: newStart, end: newEnd }); setLoading(false); return }
        } catch { /* ignore */ }
      }
      setError(err.response?.data?.detail || 'That time is busy.')
    } finally { setLoading(false) }
  }

  const requestSlot = async (vb) => {
    try {
      await api.post('/release-requests', {
        booking_id: vb.booking_id, message: '',
        proposed_event: { move_event_id: event.id, start_time: venues.start, end_time: venues.end },
      })
      setSent(s => ({ ...s, [vb.booking_id]: true })); snack('Request sent')
    } catch { snack('Could not send request') }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > start)

  return (
    <BottomSheet open={!!event} onClose={onClose} title="Move event">
      <p className="m-muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>Pick a new time for “{event.title}”.</p>
      <div style={{ display: 'grid', gap: 12 }}>
        <input className="m-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="m-input" value={start} onChange={e => setStart(e.target.value)}>
            {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span style={{ color: 'var(--text-2)' }}>→</span>
          <select className="m-input" value={end} onChange={e => setEnd(e.target.value)}>
            {endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {venues && (
          <div className="m-warn">
            <strong>That slot is taken — request it?</strong>
            {venues.list.map(vb => (
              <div key={vb.booking_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6, fontSize: '0.84rem' }}>
                <span>{vb.resource_name} · {vb.holder_name}</span>
                {sent[vb.booking_id] ? <em style={{ color: 'var(--ok)' }}>sent ✓</em>
                  : <button type="button" className="m-link" onClick={() => requestSlot(vb)}>Request</button>}
              </div>
            ))}
          </div>
        )}

        {error && <p className="m-error">{error}</p>}
        {!venues && <Btn variant="primary" full loading={loading} onClick={save}>Move</Btn>}
      </div>
    </BottomSheet>
  )
}
