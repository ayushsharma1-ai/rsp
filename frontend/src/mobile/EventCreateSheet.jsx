import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { BottomSheet, Btn, useSnack } from './ui'
import { TIME_SLOTS, roundToNext30, localDate, localTime, toISO } from './lib'
import { haptic } from './theme'

// Reusable create-event bottom sheet — mirrors desktop CreateEventModal payloads.
// Student clashes = hard block; venue clashes offer a one-tap release request.
export default function EventCreateSheet({ open, onClose, onCreated, defaultDate }) {
  const snack = useSnack()
  const now = new Date()
  const s0 = roundToNext30(now)
  const e0 = new Date(s0.getTime() + 60 * 60 * 1000)

  const blank = () => {
    const s = roundToNext30(new Date())
    const e = new Date(s.getTime() + 60 * 60 * 1000)
    return {
      title: '', description: '',
      date: defaultDate || localDate(s),
      start_time: localTime(s), end_time: localTime(e),
      is_public: true, category: 'adhoc',
      resources: [],   // array of resource_id
      groups: [],      // array of group id
    }
  }

  const [form, setForm] = useState(blank)
  const [resources, setResources] = useState([])
  const [groups, setGroups] = useState([])
  const [clashes, setClashes] = useState([])
  const [requested, setRequested] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(blank()); setError(''); setClashes([]); setRequested({})
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
    api.get('/groups').then(r => setGroups(r.data)).catch(() => {})
  }, [open]) // eslint-disable-line

  // Live clash preview
  useEffect(() => {
    if (!open) return
    if (!form.date || !form.start_time || !form.end_time) { setClashes([]); return }
    if (form.resources.length === 0 && form.groups.length === 0) { setClashes([]); return }
    const start = toISO(form.date, form.start_time)
    const end = toISO(form.date, form.end_time)
    if (new Date(end) <= new Date(start)) { setClashes([]); return }
    let cancelled = false
    api.post('/clashes/preview', { start_time: start, end_time: end, group_ids: form.groups, resource_ids: form.resources })
      .then(r => { if (!cancelled) setClashes(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, form.date, form.start_time, form.end_time, form.resources, form.groups])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggle = (k, id) => setForm(f => ({
    ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id],
  }))

  const sendRequest = async (bookingId, resourceId) => {
    try {
      await api.post('/release-requests', {
        booking_id: bookingId, message: '',
        proposed_event: {
          title: form.title || 'Requested event', description: form.description || '',
          start_time: toISO(form.date, form.start_time), end_time: toISO(form.date, form.end_time),
          resource_id: resourceId, group_ids: form.groups, category: form.category,
        },
      })
      setRequested(p => ({ ...p, [bookingId]: true }))
      snack('Request sent')
    } catch { snack('Could not send request') }
  }

  const hasStudentClash = clashes.some(c => c.student_clash)

  const submit = async () => {
    setError('')
    if (!form.title.trim()) { setError('Give the event a title.'); return }
    if (hasStudentClash) { setError('Students here are already booked elsewhere — pick another slot.'); return }
    const start = toISO(form.date, form.start_time)
    const end = toISO(form.date, form.end_time)
    if (new Date(end) <= new Date(start)) { setError('End time must be after start time.'); return }
    setLoading(true)
    try {
      const bookings = form.resources.map(rid => ({ resource_id: rid, start_time: start, end_time: end, notes: '' }))
      await api.post('/events', {
        title: form.title, description: form.description || '',
        start_time: start, end_time: end, is_public: form.is_public,
        bookings, group_ids: form.groups, category: form.category,
      })
      haptic(12); snack('Event created'); onCreated && onCreated()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create event.')
    } finally { setLoading(false) }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > form.start_time)

  return (
    <BottomSheet open={open} onClose={onClose} title="New event">
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label className="m-label">Title</label>
          <input className="m-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Algorithms Lecture" />
        </div>

        <div>
          <label className="m-label">Description</label>
          <textarea className="m-input" rows={2} style={{ paddingTop: 12, height: 'auto' }}
            value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
        </div>

        <div>
          <label className="m-label">Category</label>
          <select className="m-input" value={form.category} onChange={e => set('category', e.target.value)}>
            <option value="adhoc">Ad-hoc event</option>
            <option value="academic">Academic / timetable</option>
          </select>
        </div>

        <div>
          <label className="m-label">Date</label>
          <input className="m-input" type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="m-label">Start</label>
            <select className="m-input" value={form.start_time} onChange={e => set('start_time', e.target.value)}>
              {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <span style={{ paddingBottom: 13, color: 'var(--text-2)' }}>→</span>
          <div style={{ flex: 1 }}>
            <label className="m-label">End</label>
            <select className="m-input" value={form.end_time} onChange={e => set('end_time', e.target.value)}>
              {endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        {resources.length > 0 && (
          <div>
            <label className="m-label">Resources</label>
            <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 }}>
              {resources.map(r => (
                <button key={r.id} type="button"
                  className={`m-chip ${form.resources.includes(r.id) ? 'm-chip--active' : ''}`}
                  onClick={() => { haptic(); toggle('resources', r.id) }}>
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {groups.length > 0 && (
          <div>
            <label className="m-label">Groups (clash detection)</label>
            <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 }}>
              {groups.map(g => (
                <button key={g.id} type="button"
                  className={`m-chip ${form.groups.includes(g.id) ? 'm-chip--active' : ''}`}
                  onClick={() => { haptic(); toggle('groups', g.id) }}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {clashes.length > 0 && (
          <div className="m-warn">
            <strong>⚠ {clashes.length} possible clash{clashes.length > 1 ? 'es' : ''}</strong>
            {clashes.map(c => (
              <div key={c.event_id} style={{ marginTop: 6 }}>
                <div style={{ fontWeight: 600 }}>{c.title}
                  {c.venue_clash && <span className="m-muted"> · same room</span>}
                  {c.student_clash && <span style={{ color: 'var(--danger)' }}> · {c.shared_student_count} shared student{c.shared_student_count > 1 ? 's' : ''}</span>}
                </div>
                {(c.venue_bookings || []).map(vb => (
                  <div key={vb.booking_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4, fontSize: '0.84rem' }}>
                    <span>{vb.resource_name} · {vb.holder_name}</span>
                    {requested[vb.booking_id]
                      ? <em style={{ color: 'var(--ok)' }}>sent ✓</em>
                      : <button type="button" className="m-link" onClick={() => sendRequest(vb.booking_id, vb.resource_id)}>Request</button>}
                  </div>
                ))}
              </div>
            ))}
            {hasStudentClash && <div style={{ color: 'var(--danger)', marginTop: 8, fontWeight: 600 }}>Student clash blocks booking.</div>}
          </div>
        )}

        <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <input type="checkbox" checked={form.is_public} onChange={e => set('is_public', e.target.checked)} />
          <span style={{ fontWeight: 500 }}>Visible to all users</span>
        </label>

        {error && <p className="m-error">{error}</p>}

        <Btn variant="primary" full loading={loading} disabled={hasStudentClash} onClick={submit}>Create event</Btn>
      </div>
    </BottomSheet>
  )
}
