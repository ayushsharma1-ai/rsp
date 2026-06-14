import React, { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { ListSkeleton, Empty, Btn, DetailRow, useSnack } from '../mobile/ui'
import { TIME_SLOTS, toISO } from '../mobile/lib'
import SheetV3 from './SheetV3'
import { useAutoRefresh } from './useAutoRefresh'

// Booking status -> theme-aware accent (the "coloured booking filters" from the
// spec). Colors live in v3.css as --st-* vars so they stay readable in both
// light and dark; here we just reference the right CSS class / variable.
const STATUS = [
  { key: '', label: 'All', cls: 'stat--all' },
  { key: 'pending', label: 'Pending', cls: 'stat--pending' },
  { key: 'confirmed', label: 'Confirmed', cls: 'stat--confirmed' },
  { key: 'approved', label: 'Approved', cls: 'stat--approved' },
  { key: 'rejected', label: 'Rejected', cls: 'stat--rejected' },
  { key: 'cancelled', label: 'Cancelled', cls: 'stat--cancelled' },
]
const clsOf = (s) => STATUS.find(x => x.key === s)?.cls || 'stat--cancelled'
const accentVar = (s) => `var(--st-${s || 'cancelled'})`
const fmt = (s, f = 'MMM d · HH:mm') => { try { return format(new Date(s), f) } catch { return s } }
const EDITABLE = ['pending', 'confirmed', 'approved']

export function BookingsV3() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const snack = useSnack()
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = useCallback((silent = false) => {
    if (!silent) setItems(null)
    api.get('/bookings', { params: filter ? { status: filter } : {} }).then(r => setItems(r.data)).catch(() => setItems(prev => prev || []))
  }, [filter])
  useEffect(() => { load() }, [load])
  useAutoRefresh(() => load(true), 25000)

  const run = async (fn, msg) => {
    try { await fn(); setSel(null); snack(msg); load() } catch (e) { snack(e.response?.data?.detail || 'Action failed') }
  }
  const review = (id, st) => run(() => api.patch(`/bookings/${id}/review`, null, { params: { new_status: st } }), `Booking ${st}`)
  const cancel = (id) => run(() => api.patch(`/bookings/${id}/cancel`), 'Booking cancelled')

  return (
    <div>
      <div className="m-chips">
        {STATUS.map(s => (
          <button key={s.key} className={`stat ${s.cls} ${filter === s.key ? 'is-on' : ''}`} onClick={() => setFilter(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {items === null ? <ListSkeleton /> :
        items.length === 0 ? <Empty text="No bookings." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map(b => (
              <button key={b.id} className="m-card m-eventrow" style={{ textAlign: 'left', borderLeft: '3px solid', borderLeftColor: accentVar(b.status) }} onClick={() => setSel(b)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.event_title || 'Booking'}</div>
                  <div className="m-muted" style={{ fontSize: '0.82rem' }}>{b.resource_name} · {fmt(b.start_time)}</div>
                </div>
                <span className={`statbadge ${clsOf(b.status)}`}>{b.status}</span>
              </button>
            ))}
          </div>}

      <SheetV3 open={!!sel} onClose={() => setSel(null)} title={sel?.event_title || 'Booking'}>
        {sel && (
          <>
            <DetailRow label="Resource" value={sel.resource_name || '—'} />
            <DetailRow label="When" value={`${fmt(sel.start_time, 'EEE, MMM d · HH:mm')} – ${fmt(sel.end_time, 'HH:mm')}`} />
            {isAdmin && <DetailRow label="Requested by" value={sel.requester_name || '—'} />}
            <DetailRow label="Status" value={sel.status} />
            {sel.notes && <DetailRow label="Notes" value={sel.notes} />}
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              {isAdmin && sel.status === 'pending' && (
                <>
                  <Btn variant="primary" full onClick={() => review(sel.id, 'approved')}>Approve</Btn>
                  <Btn full onClick={() => review(sel.id, 'rejected')}>Reject</Btn>
                </>
              )}
              {EDITABLE.includes(sel.status) && (
                <Btn full onClick={() => { setEditing(sel); setSel(null) }}>Edit booking</Btn>
              )}
              {EDITABLE.includes(sel.status) && (
                <Btn variant="ghost" full onClick={() => cancel(sel.id)} style={{ color: 'var(--danger)' }}>Cancel booking</Btn>
              )}
            </div>
          </>
        )}
      </SheetV3>

      <EditBookingSheet booking={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} snack={snack} />
    </div>
  )
}

function EditBookingSheet({ booking, onClose, onDone, snack }) {
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (booking) {
      setDate(format(parseISO(booking.start_time), 'yyyy-MM-dd'))
      setStart(format(parseISO(booking.start_time), 'HH:mm'))
      setEnd(format(parseISO(booking.end_time), 'HH:mm'))
      setNotes(booking.notes || ''); setError('')
    }
  }, [booking])
  if (!booking) return null

  const save = async () => {
    if (end <= start) { setError('End must be after start.'); return }
    setLoading(true); setError('')
    try {
      await api.patch(`/bookings/${booking.id}`, { start_time: toISO(date, start), end_time: toISO(date, end), notes })
      snack('Booking updated'); onDone()
    } catch (e) { setError(e.response?.data?.detail || 'That time may be busy.') }
    finally { setLoading(false) }
  }
  const endSlots = TIME_SLOTS.filter(s => s.value > start)

  return (
    <SheetV3 open={!!booking} onClose={onClose} title={`Edit · ${booking.resource_name || 'Booking'}`}>
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label className="m-label">Date & time</label>
          <input className="m-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select className="m-input" value={start} onChange={e => setStart(e.target.value)}>{TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
            <span style={{ color: 'var(--text-2)' }}>→</span>
            <select className="m-input" value={end} onChange={e => setEnd(e.target.value)}>{endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
          </div>
        </div>
        <div><label className="m-label">Notes</label>
          <input className="m-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={save}>Save changes</Btn>
      </div>
    </SheetV3>
  )
}
