import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { PageHeader, Card, Badge, Btn, Spinner, Empty, Modal, Field } from '../components/ui'
import { format } from 'date-fns'

// Request-Release dashboard (Phase 3).
const STATUS_LABEL = {
  requested: 'Pending',
  accepted_released: 'Released ✓',
  accepted_moved: 'Moved ✓',
  declined: 'Declined',
  cancelled: 'Cancelled',
}

const fmt = (s) => { try { return format(new Date(s), 'MMM d, HH:mm') } catch { return s } }

// 30-min time slots — same picker style as the create-event modal
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

export default function RequestsPage() {
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [loading, setLoading] = useState(true)
  const [shiftFor, setShiftFor] = useState(null)   // request being accepted by shifting my event

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/release-requests/incoming').then(r => setIncoming(r.data)),
      api.get('/release-requests/outgoing').then(r => setOutgoing(r.data)),
    ]).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (id, action) => {
    await api.post(`/release-requests/${id}/${action}`)
    load()
  }

  const accept = async (id, body) => {
    await api.post(`/release-requests/${id}/accept`, body)
    setShiftFor(null)
    load()
  }

  return (
    <div>
      <PageHeader title="Slot Requests" subtitle="Request a booked slot, or respond to requests for yours" />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : (
        <>
          <h3 style={{ margin: '0 0 0.75rem' }}>Incoming — people want your slot</h3>
          {incoming.length === 0 ? (
            <Empty icon="📥" title="No incoming requests" subtitle="When someone requests one of your booked slots, it shows here." />
          ) : (
            <div className="resource-grid">
              {incoming.map(req => (
                <Card key={req.id} className="resource-card">
                  <h3 className="resource-card__name">{req.event_title || 'Booking'}{req.resource_name ? ` · ${req.resource_name}` : ''}</h3>
                  <p className="resource-card__desc">{fmt(req.start_time)} → {fmt(req.end_time)}</p>
                  <p style={{ fontSize: '0.85rem' }}><strong>{req.requester_name}</strong> wants this slot.</p>
                  {req.message && <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>“{req.message}”</p>}
                  <div className="resource-card__footer" style={{ gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                    {req.status === 'requested' ? (
                      <>
                        <Btn onClick={() => accept(req.id, { mode: 'cancel' }).catch(() => {})}>Accept &amp; cancel</Btn>
                        <Btn variant="ghost" onClick={() => setShiftFor(req)}>Accept &amp; move</Btn>
                        <Btn variant="ghost" onClick={() => act(req.id, 'decline')}>Decline</Btn>
                      </>
                    ) : (
                      <Badge label={STATUS_LABEL[req.status] || req.status} />
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          <h3 style={{ margin: '1.75rem 0 0.75rem' }}>Outgoing — slots you requested</h3>
          {outgoing.length === 0 ? (
            <Empty icon="📤" title="No outgoing requests" subtitle="Request a slot from the Bookings page." />
          ) : (
            <div className="resource-grid">
              {outgoing.map(req => (
                <Card key={req.id} className="resource-card">
                  <h3 className="resource-card__name">{req.event_title || 'Booking'}{req.resource_name ? ` · ${req.resource_name}` : ''}</h3>
                  <p className="resource-card__desc">{fmt(req.start_time)} → {fmt(req.end_time)}</p>
                  <p style={{ fontSize: '0.85rem' }}>Held by <strong>{req.holder_name}</strong></p>
                  <div className="resource-card__footer" style={{ gap: '0.5rem' }}>
                    <Badge label={STATUS_LABEL[req.status] || req.status} />
                    {req.status === 'requested' && <Btn variant="ghost" onClick={() => act(req.id, 'cancel')}>Withdraw</Btn>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <ShiftModal req={shiftFor} onClose={() => setShiftFor(null)}
                  onConfirm={(body) => accept(shiftFor.id, body)} />
    </div>
  )
}

function ShiftModal({ req, onClose, onConfirm }) {
  const open = !!req
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (req) {
      setDate(new Date().toISOString().slice(0, 10))
      setStart('09:00'); setEnd('10:00'); setError('')
    }
  }, [req])

  if (!open) return null

  const confirm = async () => {
    if (end <= start) { setError('End time must be after start time'); return }
    setLoading(true); setError('')
    try {
      const new_start = new Date(`${date}T${start}`).toISOString()
      const new_end = new Date(`${date}T${end}`).toISOString()
      await onConfirm({ mode: 'shift', new_start, new_end })
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not move — that new time may be busy.')
    } finally {
      setLoading(false)
    }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > start)

  return (
    <Modal open={open} onClose={onClose} title={`Move your event — ${req.event_title || 'event'}`}>
      <p style={{ fontSize: '0.85rem', opacity: 0.75, margin: '0 0 0.75rem' }}>
        Pick a new time for your event. The original slot will then be given to{' '}
        <strong>{req.requester_name}</strong>.
      </p>
      <Field label="New date & time">
        <div className="datetime-row">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="datetime-date" />
          <select value={start} onChange={e => setStart(e.target.value)} className="datetime-time">
            {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span className="datetime-sep">→</span>
          <select value={end} onChange={e => setEnd(e.target.value)} className="datetime-time">
            {endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </Field>
      {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
      <div className="form-actions">
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={confirm} loading={loading}>Move &amp; release</Btn>
      </div>
    </Modal>
  )
}
