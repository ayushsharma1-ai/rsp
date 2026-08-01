import React, { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { format, startOfDay, endOfDay, addDays, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, X, ChevronDown } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { toISO, fdate, errText } from '../mobile/lib'
import { useAutoRefresh } from './useAutoRefresh'
import { useBackClose } from './useBackClose'
import { useConfirm } from './ConfirmSheet'
import DayGrid from './DayGrid'
import CreateEventV3 from './CreateEventV3'
import RecurringScopeSheet from './RecurringScopeSheet'
import DateJump from './DateJump'
import { UNTAGGED, eventColorFor } from './config'
import { useTheme } from '../mobile/theme'

// "12 min ago" — the fastest way to compare two competing requests at a glance.
function relTime(iso) {
  try {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (!Number.isFinite(mins)) return ''
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const h = Math.round(mins / 60)
    if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
    const d = Math.round(h / 24)
    return `${d} ${d === 1 ? 'day' : 'days'} ago`
  } catch { return '' }
}

// "Jul 30, 2:30 PM → 4:10 PM". Repeating the date on the end of a same-day range
// is pure noise, and nearly every request is same-day.
const slotRange = (a, b) => {
  const A = fdate(a)
  if (!a || !b) return A
  try {
    const da = new Date(a), dbb = new Date(b)
    const same = da.toDateString() === dbb.toDateString()
    return `${A} → ${same ? fdate(b, 'h:mm a') : fdate(b)}`
  } catch { return `${A} → ${fdate(b)}` }
}

// Does the requester actually want a DIFFERENT window from the slot they asked
// for? Normally no — they want that slot, so repeating its times is noise. Only
// a genuine mismatch (they asked for a shorter/shifted window) is worth showing.
const differentSlot = (req) => {
  const pe = req.proposed_event
  if (!pe || !pe.start_time || !pe.end_time) return false
  const same = (a, b) => {
    try { return new Date(a).getTime() === new Date(b).getTime() } catch { return false }
  }
  return !(same(pe.start_time, req.start_time) && same(pe.end_time, req.end_time))
}

const STATUS_LABEL = {
  requested: 'Pending', accepted_released: 'Released ✓', accepted_moved: 'Moved ✓',
  declined: 'Declined', cancelled: 'Cancelled',
}

// How an online event's link is stored inside the proposed event's description.
const ONLINE_PREFIX = 'Online meeting: '

// Turn a declined request back into a half-filled create sheet. The original time
// comes along too, so the clash panel fires straight away and the fork points at a
// free slot — better than dropping someone on an empty form.
const prefillOf = (req) => {
  const pe = req.proposed_event || {}
  const desc = pe.description || ''
  return {
    title: pe.title || '',
    resource_id: pe.resource_id || null,
    group_ids: pe.group_ids || [],
    link: desc.startsWith(ONLINE_PREFIX) ? desc.slice(ONLINE_PREFIX.length) : '',
  }
}

// What the requester actually wants the slot FOR. This is the point of capturing
// the details up front: the holder gives up their room knowing what replaces it,
// instead of guessing from a name.
function Wanted({ pe, groupNames, showMeta = true }) {
  if (!pe) return null
  const groups = (pe.group_ids || []).map(id => groupNames[id]).filter(Boolean)
  return (
    <div className="v-wanted">
      <div className="v-wanted__title">{pe.title || 'Requested event'}</div>
      {/* The times are normally IDENTICAL to the contested slot shown just above,
          so by default only the title is worth screen space. */}
      {showMeta && (
        <div className="v-wanted__meta">
          {slotRange(pe.start_time, pe.end_time)}
          {groups.length > 0 && <> · {groups.join(', ')}</>}
        </div>
      )}
    </div>
  )
}

export function RequestsV3() {
  const snack = useSnack()
  const [incoming, setIncoming] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [tab, setTab] = useState('incoming')
  const [moveReq, setMoveReq] = useState(null)   // request being accepted by moving my event
  const [scopeAccept, setScopeAccept] = useState(null)  // { req, body } — recurring holder picks a scope
  const [retry, setRetry] = useState(null)       // declined request being tried on another slot
  const [groupNames, setGroupNames] = useState({})
  const [confirm, confirmEl] = useConfirm()
  // ONE request is open at a time. With several pending asks the screen was a
  // wall of near-identical cards, so only the open one carries detail + actions;
  // the others collapse to the line that identifies which slot they are about.
  // `null` means "not chosen yet" -> the first row of the active tab opens, which
  // is the oldest ask (the list is deliberately oldest-first).
  // null = nothing chosen yet, so the first row shows open. '' = the user closed
  // it, so nothing is open. Otherwise it holds the id of the open request.
  const [openId, setOpenId] = useState(null)

  const load = useCallback(() => {
    api.get('/release-requests/incoming').then(r => setIncoming(r.data)).catch(() => setIncoming([]))
    api.get('/release-requests/outgoing').then(r => setOutgoing(r.data)).catch(() => setOutgoing([]))
  }, [])
  useEffect(() => { load() }, [load])
  // Group ids travel with the request; names don't — resolve them once for display.
  useEffect(() => {
    api.get('/groups')
      .then(r => setGroupNames(Object.fromEntries((r.data || []).map(g => [g.id, g.name]))))
      .catch(() => {})
  }, [])
  useAutoRefresh(load, 25000)

  // `busy` holds the request id being acted on. Without it a double-tap fired the
  // POST twice: the second came back 400 "already resolved", so a decline that
  // actually WORKED reported "Failed". It also disables the row's buttons.
  const [busy, setBusy] = useState(null)
  const act = async (id, action) => {
    if (busy) return
    setBusy(id)
    try { await api.post(`/release-requests/${id}/${action}`); snack(action === 'decline' ? 'Declined' : 'Withdrawn'); load() }
    catch (e) { snack(errText(e, 'Couldn’t save. Retry.')) }
    finally { setBusy(null) }
  }
  const accept = async (id, body) => {
    if (busy) throw new Error('busy')
    setBusy(id)
    try { await api.post(`/release-requests/${id}/accept`, body); setMoveReq(null); snack('Accepted'); load() }
    catch (e) { throw e }   // surfaced inline by the caller (cancel button or move picker)
    finally { setBusy(null) }
  }

  // Others waiting on the same slot. Accepting one closes the rest, so say so
  // before the holder commits rather than after.
  const rivalsFor = (req) => (incoming || []).filter(
    r => r.booking_id === req.booking_id && r.status === 'requested' && r.id !== req.id).length

  const confirmAccept = async (req) => {
    // Repeating event → the holder chooses the scope (this / following / all).
    if (req.is_recurring) { setScopeAccept({ req, body: { mode: 'cancel' } }); return }
    const n = rivalsFor(req)
    const extra = n ? ` Closes ${n} other request${n > 1 ? 's' : ''}.` : ''
    const ok = await confirm({
      title: 'Cancel your event?',
      body: `Slot goes to ${req.requester_name || 'the requester'}.${extra}`,
      confirmLabel: 'Cancel mine', cancelLabel: 'Go back', danger: true,
    })
    if (ok) accept(req.id, { mode: 'cancel' }).catch(() => snack('Failed'))
  }

  // Honour the holder's scope choice from the sheet. A request is for ONE date,
  // so anything wider than "this occurrence" warns first (it touches other dates
  // of the holder's own series).
  const doScopedAccept = async (scope) => {
    const { req, body } = scopeAccept
    if (scope !== 'occurrence') {
      const when = req.start_time ? format(parseISO(req.start_time), 'EEE, MMM d') : 'one date'
      const ok = await confirm({
        title: 'Affects other dates',
        body: `${req.requester_name || 'They'} asked for ${when} only.`,
        confirmLabel: 'Continue', cancelLabel: 'Go back', danger: true,
      })
      if (!ok) return
    }
    setScopeAccept(null); setMoveReq(null)
    try { await accept(req.id, { ...body, scope }) } catch { snack('Failed') }
  }

  const list = tab === 'incoming' ? incoming : outgoing

  return (
    <div>
      <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
        <button className={`m-chip ${tab === 'incoming' ? 'm-chip--active' : ''}`} onClick={() => { setTab('incoming'); setOpenId(null) }}>Incoming</button>
        <button className={`m-chip ${tab === 'outgoing' ? 'm-chip--active' : ''}`} onClick={() => { setTab('outgoing'); setOpenId(null) }}>Outgoing</button>
      </div>

      {list === null ? <ListSkeleton h={96} /> :
        list.length === 0 ? <Empty icon={tab === 'incoming' ? '📥' : '📤'}
          text={tab === 'incoming' ? 'No incoming requests.' : 'No requests sent.'} /> :
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
            {list.map((req, i) => {
              // open = explicitly chosen, or the first row when nothing is chosen
              const open = openId === null ? i === 0 : openId === req.id
              const who = tab === 'incoming' ? req.requester_name : req.holder_name
              return (
              <div key={req.id} className="m-card" style={open ? undefined : { padding: '12px 14px' }}>
                {/* The header IS the toggle. Collapsed, a card shows only what tells
                    you which slot it is about: the class, the room, when, and who. */}
                <button type="button" onClick={() => setOpenId(open ? '' : req.id)}
                  aria-expanded={open}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
                           background: 'none', border: 'none', padding: 0, margin: 0,
                           textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, display: 'block' }}>
                      {req.event_title || 'Booking'}{req.resource_name ? ` · ${req.resource_name}` : ''}
                    </span>
                    <span className="m-muted" style={{ fontSize: '0.82rem', display: 'block', marginTop: 2 }}>
                      {slotRange(req.start_time, req.end_time)}
                    </span>
                    <span style={{ fontSize: '0.86rem', display: 'block', marginTop: 4 }}>
                      <strong>{who}</strong>
                      <span className="m-muted"> · {relTime(req.created_at)}</span>
                    </span>
                  </span>
                  {req.queue_position > 1 && (
                    <span className="m-badge" style={{ flex: '0 0 auto' }}>#{req.queue_position}</span>
                  )}
                  <ChevronDown size={18} style={{ flex: '0 0 auto', marginTop: 2, opacity: 0.55,
                    transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {!open ? null : tab === 'incoming' ? (
                  <>
                    <Wanted pe={req.proposed_event} groupNames={groupNames} showMeta={false} />
                    {/* Only what the header does NOT already say. Three lines lived
                        here and two of them were the header again in a second format:
                        "Received Jul 30, 6:26 AM" restated "· 1 min ago", and "For
                        <range>" restated the slot range — identical on every ordinary
                        request, because the slot someone asks for IS the slot they
                        want. The requested range now appears only when it genuinely
                        differs, which is the one case worth a line. */}
                    <div className="m-muted" style={{ fontSize: '0.8rem', marginTop: 8, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4 }}>
                      {differentSlot(req) && (
                        <div>Wants {slotRange(req.proposed_event.start_time, req.proposed_event.end_time)}</div>
                      )}
                      {req.message && <div>“{req.message}”</div>}
                    </div>
                    {req.status === 'requested' ? (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <Btn className="act act--move" full disabled={!!busy} onClick={() => setMoveReq(req)}>Move</Btn>
                        <Btn className="act act--cancel" full disabled={!!busy} onClick={() => confirmAccept(req)}>Cancel</Btn>
                        <Btn className="act act--decline" full loading={busy === req.id} onClick={() => act(req.id, 'decline')}>Decline</Btn>
                      </div>
                    ) : <span className={`m-badge ${String(req.status).startsWith('accepted') ? 'is-confirmed' : ''}`} style={{ marginTop: 8 }}>{STATUS_LABEL[req.status] || req.status}</span>}
                  </>
                ) : (
                  <>
                    <Wanted pe={req.proposed_event} groupNames={groupNames} showMeta={false} />
                    {req.response_note && (
                      <div className="m-muted" style={{ fontSize: '0.82rem', marginTop: 6 }}>{req.response_note}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                      <span className={`m-badge ${String(req.status).startsWith('accepted') ? 'is-confirmed' : ''}`}>{STATUS_LABEL[req.status] || req.status}</span>
                      {req.status === 'requested' && (
                        <Btn variant="ghost" loading={busy === req.id} onClick={() => act(req.id, 'cancel')}>Withdraw</Btn>
                      )}
                      {req.status === 'declined' && req.proposed_event && (
                        <Btn variant="ghost" onClick={() => setRetry(req)}>Retry</Btn>
                      )}
                    </div>
                  </>
                )}
              </div>
              )
            })}
          </div>}

      {/* Moving frees the ONE requested occurrence — you're relocating that class
          to the slot you pick, so there's no scope to choose (the backend moves
          just that occurrence for a recurring event). */}
      {moveReq && <MoveDayPicker req={moveReq} onClose={() => setMoveReq(null)}
        onConfirm={(body) => accept(moveReq.id, body)} />}

      {/* Cancelling CAN span occurrences, so here the scope choice is meaningful
          and it shows over the list (no full-screen picker to hide behind). */}
      <RecurringScopeSheet open={!!scopeAccept} action="cancel"
        title={scopeAccept?.req?.event_title || 'your event'}
        hasOccurrence
        when={scopeAccept?.req?.start_time ? format(parseISO(scopeAccept.req.start_time), 'EEE, MMM d') : ''}
        onClose={() => setScopeAccept(null)} onPick={doScopedAccept} />
      {confirmEl}

      {retry && (
        <CreateEventV3
          open
          onClose={() => setRetry(null)}
          onCreated={() => { setRetry(null); load() }}
          date={format(parseISO(retry.proposed_event.start_time), 'yyyy-MM-dd')}
          start={format(parseISO(retry.proposed_event.start_time), 'HH:mm')}
          end={format(parseISO(retry.proposed_event.end_time), 'HH:mm')}
          prefill={prefillOf(retry)}
        />
      )}
    </div>
  )
}

// Full-screen day-calendar picker — same grid as creating an event, but here you
// pick a free slot to MOVE your event into. Shows that day's events for context.
function MoveDayPicker({ req, onClose, onConfirm }) {
  const [theme] = useTheme()   // event colours differ per theme (see config.js)
  const [day, setDay] = useState(() => startOfDay(parseISO(req.start_time)))
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // back button closes the move overlay rather than navigating away
  useBackClose(true, onClose)

  // the contested slot — for a repeating event, only THIS occurrence is hidden,
  // never the whole series (which used to blank out every Mon/Fri here too)
  const occAnchor = req.start_time ? +parseISO(req.start_time) : null
  const load = useCallback(() => {
    setEvents(null)
    api.get('/events/calendar', { params: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() } })
      .then(r => setEvents((r.data || []).filter(e => {
        if (e.id !== req.event_id) return true
        const es = +parseISO(e.original_time || e.start)
        return occAnchor == null ? false : es !== occAnchor
      })))
      .catch(() => setEvents([]))
  }, [day, req.event_id, occAnchor])
  useEffect(() => { load() }, [load])

  const submit = async (s, e) => {
    if (busy) return
    setError(''); setBusy(true)
    const dayStr = format(day, 'yyyy-MM-dd')
    try { await onConfirm({ mode: 'shift', new_start: toISO(dayStr, s), new_end: toISO(dayStr, e) }) }
    catch (err) { setError(errText(err, 'That slot is busy — pick another.')) }
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
        <DateJump day={day} onPick={setDay} />
        <button className="v-iconbtn" onClick={() => setDay(d => addDays(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      {error && <p className="m-error" style={{ padding: '0 16px 4px' }}>{error}</p>}

      <div className="v-moveoverlay__body">
        <DayGrid cursor={day} today={new Date()} events={events || []}
          eventColor={(e) => eventColorFor(e, theme)} confirmLabel="Move here" onConfirm={submit} />
      </div>
    </div>,
    document.body,
  )
}
