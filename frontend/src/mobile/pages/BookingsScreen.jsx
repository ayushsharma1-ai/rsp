import React, { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { ListSkeleton, Empty, Btn, BottomSheet, DetailRow, useSnack } from '../ui'

const STATUSES = ['', 'pending', 'confirmed', 'approved', 'rejected', 'cancelled']
const fmt = (s, f = 'MMM d · HH:mm') => { try { return format(new Date(s), f) } catch { return s } }

export function BookingsScreen() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const snack = useSnack()
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)

  const load = useCallback(() => {
    setItems(null)
    api.get('/bookings', { params: filter ? { status: filter } : {} })
      .then(r => setItems(r.data)).catch(() => setItems([]))
  }, [filter])
  useEffect(() => { load() }, [load])

  const run = async (fn, msg) => {
    try { await fn(); setSel(null); snack(msg); load() }
    catch (e) { snack(e.response?.data?.detail || 'Action failed') }
  }
  const review = (id, st) => run(() => api.patch(`/bookings/${id}/review`, null, { params: { new_status: st } }), `Booking ${st}`)
  const cancel = (id) => run(() => api.patch(`/bookings/${id}/cancel`), 'Booking cancelled')

  return (
    <div>
      <div className="m-chips">
        {STATUSES.map(s => (
          <button key={s} className={`m-chip ${filter === s ? 'm-chip--active' : ''}`} onClick={() => setFilter(s)}>{s || 'All'}</button>
        ))}
      </div>

      {items === null ? <ListSkeleton /> :
        items.length === 0 ? <Empty text="No bookings." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map(b => (
              <button key={b.id} className="m-card m-eventrow" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSel(b)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.event_title || 'Booking'}</div>
                  <div className="m-muted" style={{ fontSize: '0.82rem' }}>{b.resource_name} · {fmt(b.start_time)}</div>
                </div>
                <span className="m-badge">{b.status}</span>
              </button>
            ))}
          </div>}

      <BottomSheet open={!!sel} onClose={() => setSel(null)} title={sel?.event_title || 'Booking'}>
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
              {['pending', 'confirmed', 'approved'].includes(sel.status) && (
                <Btn variant="ghost" full onClick={() => cancel(sel.id)} style={{ color: 'var(--danger)' }}>Cancel booking</Btn>
              )}
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
