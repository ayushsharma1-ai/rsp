import React, { useEffect, useState, useCallback } from 'react'
import api from '../../lib/api'
import { ListSkeleton, Empty, Btn, BottomSheet, useSnack } from '../ui'
import { TIME_SLOTS, toISO, fdate } from '../lib'

const STATUS_LABEL = {
  requested: 'Pending', accepted_released: 'Released ✓', accepted_moved: 'Moved ✓',
  declined: 'Declined', cancelled: 'Cancelled',
}

export function RequestsScreen() {
  const snack = useSnack()
  const [incoming, setIncoming] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [tab, setTab] = useState('incoming')
  const [shiftFor, setShiftFor] = useState(null)

  const load = useCallback(() => {
    api.get('/release-requests/incoming').then(r => setIncoming(r.data)).catch(() => setIncoming([]))
    api.get('/release-requests/outgoing').then(r => setOutgoing(r.data)).catch(() => setOutgoing([]))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (id, action) => { try { await api.post(`/release-requests/${id}/${action}`); snack('Done'); load() } catch { snack('Failed') } }
  const accept = async (id, body) => {
    try { await api.post(`/release-requests/${id}/accept`, body); setShiftFor(null); snack('Accepted'); load() }
    catch (e) { snack(e.response?.data?.detail || 'That time may be busy'); throw e }
  }

  const list = tab === 'incoming' ? incoming : outgoing

  return (
    <div>
      <div className="m-chips">
        <button className={`m-chip ${tab === 'incoming' ? 'm-chip--active' : ''}`} onClick={() => setTab('incoming')}>Incoming</button>
        <button className={`m-chip ${tab === 'outgoing' ? 'm-chip--active' : ''}`} onClick={() => setTab('outgoing')}>Outgoing</button>
      </div>

      {list === null ? <ListSkeleton h={96} /> :
        list.length === 0 ? <Empty icon={tab === 'incoming' ? '📥' : '📤'}
          text={tab === 'incoming' ? 'No one wants your slots right now.' : 'You haven’t requested any slots.'} /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {list.map(req => (
              <div key={req.id} className="m-card">
                <div style={{ fontWeight: 600 }}>{req.event_title || 'Booking'}{req.resource_name ? ` · ${req.resource_name}` : ''}</div>
                <div className="m-muted" style={{ fontSize: '0.82rem', margin: '2px 0 8px' }}>{fdate(req.start_time)} → {fdate(req.end_time)}</div>

                {tab === 'incoming' ? (
                  <>
                    <div style={{ fontSize: '0.88rem' }}><strong>{req.requester_name}</strong> wants this slot.</div>
                    {req.message && <div className="m-muted" style={{ fontSize: '0.84rem' }}>“{req.message}”</div>}
                    {req.status === 'requested' ? (
                      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        <Btn variant="primary" full onClick={() => accept(req.id, { mode: 'cancel' }).catch(() => {})}>Accept & cancel mine</Btn>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Btn full onClick={() => setShiftFor(req)}>Accept & move</Btn>
                          <Btn full variant="ghost" onClick={() => act(req.id, 'decline')}>Decline</Btn>
                        </div>
                      </div>
                    ) : <span className="m-badge" style={{ marginTop: 8 }}>{STATUS_LABEL[req.status] || req.status}</span>}
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '0.88rem' }}>Held by <strong>{req.holder_name}</strong></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                      <span className="m-badge">{STATUS_LABEL[req.status] || req.status}</span>
                      {req.status === 'requested' && <Btn variant="ghost" onClick={() => act(req.id, 'cancel')}>Withdraw</Btn>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>}

      <ShiftSheet req={shiftFor} onClose={() => setShiftFor(null)} onConfirm={(body) => accept(shiftFor.id, body)} />
    </div>
  )
}

function ShiftSheet({ req, onClose, onConfirm }) {
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (req) { setDate(new Date().toISOString().slice(0, 10)); setStart('09:00'); setEnd('10:00'); setError('') }
  }, [req])
  if (!req) return null

  const confirm = async () => {
    if (end <= start) { setError('End must be after start.'); return }
    setLoading(true); setError('')
    try { await onConfirm({ mode: 'shift', new_start: toISO(date, start), new_end: toISO(date, end) }) }
    catch (e) { setError(e.response?.data?.detail || 'That new time may be busy.') }
    finally { setLoading(false) }
  }
  const endSlots = TIME_SLOTS.filter(s => s.value > start)

  return (
    <BottomSheet open={!!req} onClose={onClose} title="Move your event">
      <p className="m-muted" style={{ marginTop: 0, fontSize: '0.86rem' }}>
        Pick a new time for your event. The original slot then goes to <strong>{req.requester_name}</strong>.
      </p>
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
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={confirm}>Move & release</Btn>
      </div>
    </BottomSheet>
  )
}
