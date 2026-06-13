import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Badge, Card, Btn, Spinner, Modal, Field } from '../components/ui'
import { format, isFuture } from 'date-fns'
import { CalendarDays, BookOpen, Clock, ArrowRight, ChevronDown, ChevronUp, Plus } from 'lucide-react'

// ── Time slot generator (30-min increments) ───────────────────
const TIME_SLOTS = []
for (let h = 0; h < 24; h++) {
  for (let m of [0, 30]) {
    const hh = String(h).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    const ampm = h < 12 ? 'AM' : 'PM'
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
    TIME_SLOTS.push({ value: `${hh}:${mm}`, label: `${displayH}:${mm} ${ampm}` })
  }
}

function roundToNext30(d) {
  const ms = 1000 * 60 * 30
  return new Date(Math.ceil(d.getTime() / ms) * ms)
}

function fmtLocal(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── Shared CreateEventModal (used in Dashboard + Calendar) ────
export function CreateEventModal({ open, onClose, resources, onCreated }) {
  const now = new Date()
  const startDefault = roundToNext30(now)
  const endDefault = new Date(startDefault.getTime() + 60 * 60 * 1000)

  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
    date: fmtLocal(startDefault).slice(0, 10),
    start_time: fmtLocal(startDefault).slice(11),
    end_time: fmtLocal(endDefault).slice(11),
    is_public: true,
    selectedResources: [],
    selectedGroups: [],
    category: 'adhoc',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState([])
  const [clashes, setClashes] = useState([])
  const [requested, setRequested] = useState({})   // booking_id -> true once a release request is sent

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      const s = roundToNext30(new Date())
      const e2 = new Date(s.getTime() + 60 * 60 * 1000)
      setForm({
        title: '', description: '', location: '',
        date: fmtLocal(s).slice(0, 10),
        start_time: fmtLocal(s).slice(11),
        end_time: fmtLocal(e2).slice(11),
        is_public: true,
        selectedResources: [],
        selectedGroups: [],
        category: 'adhoc',
      })
      setError('')
      setClashes([])
      setRequested({})
      api.get('/groups').then(r => setGroups(r.data)).catch(() => {})
    }
  }, [open])

  // Clash preview: whenever the time window, resources, or groups change,
  // ask the backend whether this proposed event would clash with anything.
  useEffect(() => {
    if (!open) return
    const resourceIds = form.selectedResources.map(r => r.resource_id).filter(Boolean)
    if (!form.date || !form.start_time || !form.end_time) { setClashes([]); return }
    if (resourceIds.length === 0 && form.selectedGroups.length === 0) { setClashes([]); return }
    const startISO = new Date(`${form.date}T${form.start_time}`).toISOString()
    const endISO = new Date(`${form.date}T${form.end_time}`).toISOString()
    if (new Date(endISO) <= new Date(startISO)) { setClashes([]); return }
    let cancelled = false
    api.post('/clashes/preview', {
      start_time: startISO, end_time: endISO,
      group_ids: form.selectedGroups, resource_ids: resourceIds,
    }).then(r => { if (!cancelled) setClashes(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, form.date, form.start_time, form.end_time, form.selectedResources, form.selectedGroups])

  const set = k => e => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(f => ({ ...f, [k]: v }))
  }

  const addResource = () =>
    setForm(f => ({ ...f, selectedResources: [...f.selectedResources, { resource_id: '', notes: '' }] }))

  const removeResource = i =>
    setForm(f => ({ ...f, selectedResources: f.selectedResources.filter((_, idx) => idx !== i) }))

  const setResource = (i, field, val) =>
    setForm(f => {
      const r = [...f.selectedResources]
      r[i] = { ...r[i], [field]: val }
      return { ...f, selectedResources: r }
    })

  const sendRequest = async (bookingId, resourceId) => {
    try {
      const startISO = new Date(`${form.date}T${form.start_time}`).toISOString()
      const endISO = new Date(`${form.date}T${form.end_time}`).toISOString()
      await api.post('/release-requests', {
        booking_id: bookingId,
        message: '',
        // capture what the requester is trying to book, so accept can auto-create it
        proposed_event: {
          title: form.title || 'Requested event',
          description: form.description || '',
          start_time: startISO,
          end_time: endISO,
          resource_id: resourceId,
          group_ids: form.selectedGroups,
          category: form.category,
        },
      })
      setRequested(prev => ({ ...prev, [bookingId]: true }))
    } catch (e) { /* ignore */ }
  }

  const submit = async e => {
    e.preventDefault()
    setError('')
    // Student clashes are a hard block (policy) — stop before hitting the server.
    if (clashes.some(c => c.student_clash)) {
      setError('This time clashes with students already booked elsewhere — pick a different slot.')
      return
    }
    setLoading(true)
    try {
      const startISO = new Date(`${form.date}T${form.start_time}`).toISOString()
      const endISO = new Date(`${form.date}T${form.end_time}`).toISOString()

      if (new Date(endISO) <= new Date(startISO)) {
        setError('End time must be after start time')
        setLoading(false)
        return
      }

      const bookings = form.selectedResources
        .filter(r => r.resource_id)
        .map(r => ({
          resource_id: r.resource_id,
          start_time: startISO,
          end_time: endISO,
          notes: r.notes || '',
        }))

      await api.post('/events', {
        title: form.title,
        description: form.description || '',
        start_time: startISO,
        end_time: endISO,
        is_public: form.is_public,
        bookings,
        group_ids: form.selectedGroups,
        category: form.category,
      })
      onCreated()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create event')
    } finally {
      setLoading(false)
    }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > form.start_time)

  return (
    <Modal open={open} onClose={onClose} title="Create New Event" width={560}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Event Title">
          <input
            value={form.title}
            onChange={set('title')}
            placeholder="e.g. Advanced Algorithms Lecture"
            required
          />
        </Field>

        <Field label="Description">
          <textarea
            value={form.description}
            onChange={set('description')}
            placeholder="Optional details..."
            rows={2}
          />
        </Field>

        <Field label="Location">
          <input
            value={form.location}
            onChange={set('location')}
            placeholder="e.g. Building A, Room 101"
          />
        </Field>

        <Field label="Category">
          <select value={form.category} onChange={set('category')}>
            <option value="adhoc">Ad-hoc event</option>
            <option value="academic">Academic / timetable</option>
          </select>
        </Field>

        {/* Google-Calendar-style date + time picker */}
        <Field label="Date & Time">
          <div className="datetime-row">
            <input
              type="date"
              value={form.date}
              onChange={set('date')}
              className="datetime-date"
              required
            />
            <select value={form.start_time} onChange={set('start_time')} className="datetime-time">
              {TIME_SLOTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <span className="datetime-sep">→</span>
            <select value={form.end_time} onChange={set('end_time')} className="datetime-time">
              {endSlots.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </Field>

        {/* Multiple resources */}
        <Field label="Resources Needed">
          <div className="resource-picker">
            {form.selectedResources.map((r, i) => (
              <div key={i} className="resource-picker__row">
                <select
                  value={r.resource_id}
                  onChange={e => setResource(i, 'resource_id', e.target.value)}
                  style={{ flex: 2 }}
                >
                  <option value="">— Select resource —</option>
                  {resources.map(res => (
                    <option key={res.id} value={res.id}>
                      {res.name} · {res.resource_type.replace(/_/g, ' ')}
                      {res.requires_approval ? ' ⚠ approval needed' : ' ✓ auto-confirm'}
                    </option>
                  ))}
                </select>
                <input
                  value={r.notes}
                  onChange={e => setResource(i, 'notes', e.target.value)}
                  placeholder="Notes (optional)"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="resource-picker__remove"
                  onClick={() => removeResource(i)}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="resource-picker__add" onClick={addResource}>
              + Add Resource
            </button>
          </div>
        </Field>

        <Field label="Groups (for clash detection)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {groups.length === 0 && (
              <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>
                No groups yet — create some on the Groups page.
              </span>
            )}
            {groups.map(g => {
              const checked = form.selectedGroups.includes(g.id)
              return (
                <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setForm(f => ({
                      ...f,
                      selectedGroups: checked
                        ? f.selectedGroups.filter(id => id !== g.id)
                        : [...f.selectedGroups, g.id],
                    }))}
                    style={{ width: 'auto' }}
                  />
                  {g.name}
                </label>
              )
            })}
          </div>
        </Field>

        {clashes.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.85rem', color: '#7c2d12' }}>
            <strong style={{ color: '#c2410c' }}>
              ⚠ {clashes.length} possible clash{clashes.length > 1 ? 'es' : ''} at this time:
            </strong>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {clashes.map(c => (
                <li key={c.event_id}>
                  <strong>{c.title}</strong>
                  {c.venue_clash && <span> · same room</span>}
                  {c.student_clash && <span> · {c.shared_student_count} shared student{c.shared_student_count > 1 ? 's' : ''}</span>}
                  {(c.venue_bookings || []).map(vb => (
                    <div key={vb.booking_id} style={{ marginTop: '0.2rem' }}>
                      Room <strong>{vb.resource_name}</strong> held by {vb.holder_name} —{' '}
                      {requested[vb.booking_id]
                        ? <em style={{ color: '#15803d' }}>request sent ✓</em>
                        : <button type="button" onClick={() => sendRequest(vb.booking_id, vb.resource_id)}
                            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                            Send request
                          </button>}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={set('is_public')}
              style={{ width: 'auto' }}
            />
            Visible to all users
          </label>
        </Field>

        {error && (
          <p className="form-error">{error}</p>
        )}

        <div className="form-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Create Event</Btn>
        </div>
      </form>
    </Modal>
  )
}

// ── Dashboard Page ────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [data, setData] = useState({ bookings: [], events: [] })
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedEvent, setExpandedEvent] = useState(null)
  const [showCreate, setShowCreate] = useState(false)

  const fetchAll = () => {
    setLoading(true)
    Promise.all([
      api.get('/bookings').catch(() => ({ data: [] })),
      api.get('/events').catch(() => ({ data: [] })),
      api.get('/resources').catch(() => ({ data: [] })),
    ]).then(([b, e, r]) => {
      setData({ bookings: b.data, events: e.data })
      setResources(r.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <Spinner size={32} />
    </div>
  )

  const pending = data.bookings.filter(b => b.status === 'pending').length
  const confirmed = data.bookings.filter(b => b.status === 'confirmed').length

  // Only future events, ascending order, max 5
  const upcoming = data.events
    .filter(e => isFuture(new Date(e.start_time)) && e.status !== 'cancelled')
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5)

  const stats = [
    {
      label: 'Total Bookings',
      value: data.bookings.length,
      sub: 'all time',
      icon: BookOpen,
      color: 'var(--accent2)',
      onClick: () => navigate('/bookings'),
    },
    {
      label: 'Pending Review',
      value: pending,
      sub: 'awaiting approval',
      icon: Clock,
      color: 'var(--yellow)',
      onClick: () => navigate('/bookings'),
    },
    {
      label: 'Confirmed',
      value: confirmed,
      sub: 'active bookings',
      icon: CalendarDays,
      color: 'var(--green)',
      onClick: () => navigate('/bookings'),
    },
  ]

  return (
    <div>
      <div className="dash-welcome">
        <div>
          <h1 className="dash-welcome__title">
            Welcome back, {user?.full_name?.split(' ')[0]} 👋
          </h1>
          <p className="dash-welcome__sub">Here's what's happening across the platform.</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Badge label={user?.role} type={user?.role} />
          <Btn onClick={() => setShowCreate(true)} size="sm">
            <Plus size={14} /> New Event
          </Btn>
        </div>
      </div>

      {/* Clickable stat cards — 3 only, no Resources card */}
      <div className="stats-grid" style={{ marginBottom: '1.75rem' }}>
        {stats.map(s => (
          <div
            key={s.label}
            className="stat-card stat-card--clickable"
            onClick={s.onClick}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <p className="stat-card__label">{s.label}</p>
              <s.icon size={16} color={s.color} />
            </div>
            <p className="stat-card__value" style={{ color: s.color }}>{s.value}</p>
            <p className="stat-card__sub">
              {s.sub}
              <ArrowRight size={11} style={{ marginLeft: '4px', verticalAlign: 'middle', opacity: 0.5 }} />
            </p>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        {/* Upcoming Events — expandable */}
        <Card>
          <div className="section-header">
            <h2 className="section-title">Upcoming Events</h2>
            <button className="section-link" onClick={() => navigate('/calendar')}>
              View calendar <ArrowRight size={14} />
            </button>
          </div>

          {upcoming.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: '0.875rem', padding: '1rem 0' }}>
              No upcoming events.
            </p>
          ) : (
            <div className="event-list">
              {upcoming.map(evt => {
                const isExpanded = expandedEvent === evt.id
                const booking = data.bookings.find(b => b.event_id === evt.id)
                const durationMins = Math.round(
                  (new Date(evt.end_time) - new Date(evt.start_time)) / 60000
                )

                return (
                  <div key={evt.id} className="event-item event-item--expandable">
                    {/* Clickable header row */}
                    <div
                      className="event-item__header"
                      onClick={() => setExpandedEvent(isExpanded ? null : evt.id)}
                    >
                      <div className="event-item__dot" />
                      <div className="event-item__body">
                        <p className="event-item__title">{evt.title}</p>
                        <p className="event-item__time">
                          {format(new Date(evt.start_time), 'EEE, MMM d · h:mm a')}
                          {' – '}
                          {format(new Date(evt.end_time), 'h:mm a')}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        <Badge label={evt.status} type={evt.status} />
                        {isExpanded
                          ? <ChevronUp size={14} color="var(--text3)" />
                          : <ChevronDown size={14} color="var(--text3)" />
                        }
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="event-item__details">
                        {evt.description && (
                          <div className="event-detail-row">
                            <span className="event-detail-label">About</span>
                            <span>{evt.description}</span>
                          </div>
                        )}
                        <div className="event-detail-row">
                          <span className="event-detail-label">Duration</span>
                          <span>
                            {durationMins >= 60
                              ? `${Math.floor(durationMins / 60)}h ${durationMins % 60 > 0 ? `${durationMins % 60}m` : ''}`
                              : `${durationMins}m`
                            }
                          </span>
                        </div>
                        {booking && (
                          <div className="event-detail-row">
                            <span className="event-detail-label">Resource</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              {booking.resource_name}
                              <Badge label={booking.status} type={booking.status} />
                            </span>
                          </div>
                        )}
                        <div className="event-detail-row">
                          <span className="event-detail-label">Visibility</span>
                          <span>{evt.is_public ? 'Public' : 'Private'}</span>
                        </div>
                        <div style={{ marginTop: '0.65rem' }}>
                          <Btn
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate('/calendar')}
                          >
                            Open in Calendar <ArrowRight size={12} />
                          </Btn>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Recent Bookings */}

      </div>

      <CreateEventModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        resources={resources}
        onCreated={() => { setShowCreate(false); fetchAll() }}
      />
    </div>
  )
}
