import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { format, startOfDay, endOfDay, addDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { toISO, fdate } from '../mobile/lib'
import { useAutoRefresh } from './useAutoRefresh'
import DayGrid from './DayGrid'

const STATUS_LABEL = {
  requested: 'Pending', accepted_released: 'Released ✓', accepted_moved: 'Moved ✓',
  declined: 'Declined', cancelled: 'Cancelled',
}

export function RequestsV3() {
  const snack = useSnack()
  const [incoming, setIncoming] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [tab, setTab] = useState('incoming')
  const [moveReq, setMoveReq] = useState(null)   // request being accepted by moving my event

  const load = useCallback(() => {
    api.get('/release-requests/incoming').then(r => setIncoming(r.data)).catch(() => setIncoming([]))
    api.get('/release-requests/outgoing').then(r => setOutgoing(r.data)).catch(() => setOutgoing([]))
  }, [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(load, 25000)

  const act = async (id, action) => { try { await api.post(`/release-requests/${id}/${action}`); snack('Done'); load() } catch { snack('Failed') } }
  const accept = async (id, body) => {
    try { await api.post(`/release-requests/${id}/accept`, body); setMoveReq(null); snack('Accepted'); load() }
    catch (e) { throw e }   // surfaced inline by the caller (cancel button or move picker)
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
                        <Btn variant="primary" full onClick={() => { if (window.confirm('Accept and cancel your event in this slot?')) accept(req.id, { mode: 'cancel' }).catch(() => snack('Failed')) }}>Accept & cancel mine</Btn>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <Btn full onClick={() => setMoveReq(req)}>Accept & move</Btn>
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

      {moveReq && <MoveDayPicker req={moveReq} onClose={() => setMoveReq(null)} onConfirm={(body) => accept(moveReq.id, body)} />}
    </div>
  )
}

// Full-screen day-calendar picker — same grid as creating an event, but here you
// pick a free slot to MOVE your event into. Shows that day's events for context.
function MoveDayPicker({ req, onClose, onConfirm }) {
  const [day, setDay] = useState(() => startOfDay(parseISO(req.start_time)))
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setEvents(null)
    api.get('/events/calendar', { params: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() } })
      .then(r => setEvents(r.data)).catch(() => setEvents([]))
  }, [day])
  useEffect(() => { load() }, [load])

  const submit = async (s, e) => {
    if (busy) return
    setError(''); setBusy(true)
    const dayStr = format(day, 'yyyy-MM-dd')
    try { await onConfirm({ mode: 'shift', new_start: toISO(dayStr, s), new_end: toISO(dayStr, e) }) }
    catch (err) { setError(err.response?.data?.detail || 'That slot is busy — pick another.') }
    finally { setBusy(false) }
  }

  return ReactDOM.createPortal(
    <div className="v-moveoverlay">
      <div className="v-moveoverlay__head">
        <button className="v-iconbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Move your event</div>
          <div className="m-muted" style={{ fontSize: '0.76rem' }}>Original slot goes to {req.requester_name}</div>
        </div>
        <div style={{ width: 40, flex: '0 0 40px' }} />
      </div>

      <div className="v-moveoverlay__nav">
        <button className="v-iconbtn" onClick={() => setDay(d => addDays(d, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <span style={{ fontWeight: 700 }}>{format(day, 'EEE, MMM d')}</span>
        <button className="v-iconbtn" onClick={() => setDay(d => addDays(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      {error && <p className="m-error" style={{ padding: '0 16px 4px' }}>{error}</p>}

      <div className="v-moveoverlay__body">
        <DayGrid cursor={day} today={new Date()} events={events || []}
          eventColor={(e) => e.color || '#5b6ef5'} confirmLabel="Move here" onConfirm={submit} />
      </div>
    </div>,
    document.body,
  )
}
