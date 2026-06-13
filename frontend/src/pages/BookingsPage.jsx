import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PageHeader, Table, Badge, Btn, Modal, Spinner, Field } from '../components/ui'
import { format } from 'date-fns'
import { CheckCircle, XCircle, Ban, Edit2 } from 'lucide-react'

const STATUS_OPTS = ['', 'pending', 'confirmed', 'approved', 'rejected', 'cancelled']

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

function fmtLocal(d) {
  const pad = n => String(n).padStart(2, '0')
  const dt = new Date(d)
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

export default function BookingsPage() {
  const { user } = useAuthStore()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const isAdmin = user?.role === 'admin'

  const fetchBookings = useCallback(() => {
    setLoading(true)
    const params = filter ? { status: filter } : {}
    api.get('/bookings', { params })
      .then(r => setBookings(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const reviewBooking = async (id, newStatus) => {
    await api.patch(`/bookings/${id}/review`, null, { params: { new_status: newStatus } })
    setSelected(null)
    fetchBookings()
  }

  const cancelBooking = async (id) => {
    await api.patch(`/bookings/${id}/cancel`)
    setSelected(null)
    fetchBookings()
  }

  const columns = [
    {
      key: 'event_title', label: 'Event',
      render: v => <strong style={{ color: 'var(--text)' }}>{v || '–'}</strong>
    },
    { key: 'resource_name', label: 'Resource', render: v => v || '–' },
    ...(isAdmin ? [{ key: 'requester_name', label: 'Requested By' }] : []),
    {
      key: 'start_time', label: 'Time',
      render: (v, row) => (
        <span style={{ fontSize: '0.82rem' }}>
          {format(new Date(v), 'MMM d, h:mm a')} – {format(new Date(row.end_time), 'h:mm a')}
        </span>
      )
    },
    { key: 'status', label: 'Status', render: v => <Badge label={v} type={v} /> },
    {
      key: 'id', label: 'Actions',
      render: (id, row) => (
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {isAdmin && row.status === 'pending' && (
            <>
              <Btn size="sm" variant="success"
                onClick={e => { e.stopPropagation(); reviewBooking(id, 'approved') }}>
                <CheckCircle size={13} /> Approve
              </Btn>
              <Btn size="sm" variant="danger"
                onClick={e => { e.stopPropagation(); reviewBooking(id, 'rejected') }}>
                <XCircle size={13} /> Reject
              </Btn>
            </>
          )}
          {['pending', 'confirmed', 'approved'].includes(row.status) && (
            <Btn size="sm" variant="ghost"
              onClick={e => { e.stopPropagation(); setEditing(row) }}>
              <Edit2 size={13} /> Edit
            </Btn>
          )}
        </div>
      )
    }
  ]

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle={isAdmin ? 'Manage all booking requests' : 'Your booking requests'}
      />

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {STATUS_OPTS.map(s => (
          <button
            key={s}
            className={`filter-btn ${filter === s ? 'filter-btn--active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Spinner size={28} />
        </div>
      ) : (
        <Table columns={columns} data={bookings} onRow={setSelected} />
      )}

      {/* Detail modal */}
      {selected && !editing && (
        <BookingDetailModal
          booking={selected}
          isAdmin={isAdmin}
          currentUserId={user?.id}
          onClose={() => setSelected(null)}
          onApprove={id => reviewBooking(id, 'approved')}
          onReject={id => reviewBooking(id, 'rejected')}
          onCancel={cancelBooking}
          onEdit={row => { setSelected(null); setEditing(row) }}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <EditBookingModal
          booking={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetchBookings() }}
        />
      )}
    </div>
  )
}

// ── Detail Modal ──────────────────────────────────────────────
function BookingDetailModal({ booking: b, isAdmin, currentUserId, onClose, onApprove, onReject, onCancel, onEdit }) {
  const [requested, setRequested] = useState(false)
  // You can request a slot you don't already hold, if it's still active.
  const canRequest = b.requester_id && b.requester_id !== currentUserId &&
    ['pending', 'confirmed', 'approved'].includes(b.status)
  const requestSlot = async () => {
    try { await api.post('/release-requests', { booking_id: b.id, message: '' }); setRequested(true) }
    catch (e) { /* ignore */ }
  }
  return (
    <Modal open title="Booking Details" onClose={onClose} width={480}>
      <div className="detail-grid">
        <DetailRow label="Event"       value={b.event_title || '–'} />
        <DetailRow label="Resource"    value={b.resource_name || '–'} />
        {isAdmin && <DetailRow label="Requested By" value={b.requester_name || '–'} />}
        <DetailRow label="Start"       value={format(new Date(b.start_time), 'EEEE, MMM d yyyy, h:mm a')} />
        <DetailRow label="End"         value={format(new Date(b.end_time), 'h:mm a')} />
        <DetailRow label="Status"      value={<Badge label={b.status} type={b.status} />} />
        {b.notes && <DetailRow label="Notes"  value={b.notes} />}
        <DetailRow label="Created"     value={format(new Date(b.created_at), 'MMM d, yyyy h:mm a')} />
      </div>

      <div className="form-actions">
        {isAdmin && b.status === 'pending' && (
          <>
            <Btn variant="success" onClick={() => onApprove(b.id)}>
              <CheckCircle size={14} /> Approve
            </Btn>
            <Btn variant="danger" onClick={() => onReject(b.id)}>
              <XCircle size={14} /> Reject
            </Btn>
          </>
        )}
        {['pending', 'confirmed', 'approved'].includes(b.status) && (
          <>
            <Btn variant="ghost" onClick={() => onEdit(b)}>
              <Edit2 size={14} /> Edit
            </Btn>
            {/* faded red cancel button */}
            <Btn variant="danger" onClick={() => onCancel(b.id)}>
              <Ban size={14} /> Cancel
            </Btn>
          </>
        )}
        {canRequest && (
          requested
            ? <Badge label="Request sent ✓" />
            : <Btn variant="ghost" onClick={requestSlot}>Request this slot</Btn>
        )}
      </div>
    </Modal>
  )
}

// ── Edit Booking Modal ────────────────────────────────────────
function EditBookingModal({ booking: b, onClose, onSaved }) {
  const startDt = new Date(b.start_time)
  const endDt   = new Date(b.end_time)
  const pad = n => String(n).padStart(2, '0')
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const toTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const [form, setForm] = useState({
    date:       toDate(startDt),
    start_time: toTime(startDt),
    end_time:   toTime(endDt),
    notes:      b.notes || '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [clashes, setClashes] = useState([])

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  // Preview clashes (room + students) at the NEW time as the user edits
  useEffect(() => {
    if (!b.event_id) return
    const startISO = new Date(`${form.date}T${form.start_time}`).toISOString()
    const endISO   = new Date(`${form.date}T${form.end_time}`).toISOString()
    if (new Date(endISO) <= new Date(startISO)) { setClashes([]); return }
    let cancelled = false
    api.get(`/clashes/event/${b.event_id}`, { params: { start: startISO, end: endISO } })
      .then(r => { if (!cancelled) setClashes(r.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [form.date, form.start_time, form.end_time, b.event_id])

  const submit = async e => {
    e.preventDefault()
    setError('')
    // Student clash is a hard block (policy) — stop before hitting the server.
    if (clashes.some(c => c.student_clash)) {
      setError('This time clashes with students already booked elsewhere — pick a different slot.')
      return
    }
    setLoading(true)
    try {
      const startISO = new Date(`${form.date}T${form.start_time}`).toISOString()
      const endISO   = new Date(`${form.date}T${form.end_time}`).toISOString()
      if (new Date(endISO) <= new Date(startISO)) {
        setError('End time must be after start time')
        setLoading(false)
        return
      }
      await api.patch(`/bookings/${b.id}`, {
        start_time: startISO,
        end_time:   endISO,
        notes:      form.notes,
      })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update booking')
    } finally {
      setLoading(false)
    }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > form.start_time)

  return (
    <Modal open title="Edit Booking" onClose={onClose} width={480}>
      {/* Context info */}
      <div style={{ background: 'var(--bg3)', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text2)' }}>
        <strong style={{ color: 'var(--text)' }}>{b.event_title || 'Event'}</strong>
        {' · '}
        {b.resource_name}
      </div>

      <form onSubmit={submit} className="form-grid">
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

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={set('notes')}
            placeholder="Optional notes..."
            rows={2}
          />
        </Field>

        {clashes.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8, padding: '0.6rem 0.8rem', fontSize: '0.85rem', color: '#7c2d12' }}>
            <strong style={{ color: '#c2410c' }}>
              ⚠ New time clashes with {clashes.length} event{clashes.length > 1 ? 's' : ''}:
            </strong>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {clashes.map(c => (
                <li key={c.event_id}>
                  <strong>{c.title}</strong>
                  {c.venue_clash && <span> · same room</span>}
                  {c.student_clash && <span> · {c.shared_student_count} shared student{c.shared_student_count > 1 ? 's' : ''}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Save Changes</Btn>
        </div>
      </form>
    </Modal>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}</span>
    </div>
  )
}
