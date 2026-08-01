import React, { useEffect, useState, useCallback } from 'react'
import { format, parseISO, startOfDay } from 'date-fns'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { ListSkeleton, Empty, Btn, DetailRow, useSnack } from '../mobile/ui'
import { toISO, errText } from '../mobile/lib'
import SheetV3 from './SheetV3'
import { APPROVALS_ENABLED } from './features'
import DateJump from './DateJump'
import TimeRange, { timeRangeError } from './TimeRange'
import { useConfirm } from './ConfirmSheet'
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
// Pending / Approved / Rejected only exist while approvals do. With the flow off
// they are filters that can only ever return nothing, so they don't earn a chip.
// STATUS itself is left whole — clsOf and labelOf still need every key to render a
// badge correctly if a row in one of those states ever arrives.
const VISIBLE_STATUS = APPROVALS_ENABLED
  ? STATUS
  : STATUS.filter(s => !['pending', 'approved', 'rejected'].includes(s.key))
const clsOf = (s) => STATUS.find(x => x.key === s)?.cls || 'stat--cancelled'
// Humanise the raw enum ("pending" -> "Pending") for display — cards and the detail
// sheet were showing the lowercase enum value verbatim.
const labelOf = (s) => STATUS.find(x => x.key === s)?.label || (s ? s[0].toUpperCase() + s.slice(1) : s)
const accentVar = (s) => `var(--st-${s || 'cancelled'})`
const fmt = (s, f = 'MMM d · h:mm a') => { try { return format(new Date(s), f) } catch { return s } }
const EDITABLE = ['pending', 'confirmed', 'approved']

export function BookingsV3() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const snack = useSnack()
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('')
  const [sel, setSel] = useState(null)
  const [editing, setEditing] = useState(null)
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback((silent = false) => {
    if (!silent) setItems(null)
    api.get('/bookings', { params: filter ? { status: filter } : {} }).then(r => setItems(r.data)).catch(() => setItems(prev => prev || []))
  }, [filter])
  useEffect(() => { load() }, [load])
  useAutoRefresh(() => load(true), 25000)

  // `busy` stops a double tap firing the same review twice — the second call hits
  // the booking FSM and 400s, so a successful approval reported a raw backend
  // error ("Cannot transition from approved to approved") right after its own
  // success toast.
  const [busy, setBusy] = useState(false)
  const run = async (fn, msg) => {
    if (busy) return
    setBusy(true)
    try { await fn(); setSel(null); snack(msg); load() }
    catch (e) { snack(errText(e, 'Couldn’t save. Retry.')) }
    finally { setBusy(false) }
  }
  const review = (id, st) => run(() => api.patch(`/bookings/${id}/review`, null, { params: { new_status: st } }), `Booking ${st}`)
  // Rejection is TERMINAL in the backend FSM — there is no route back to pending
  // or approved — and the button sits directly under Approve.
  const confirmReject = async (b) => {
    const ok = await confirm({
      title: 'Reject this booking?',
      body: `${b.requester_name || 'They'} are told. Can’t be undone.`,
      confirmLabel: 'Reject booking', cancelLabel: 'Go back', danger: true,
    })
    if (ok) review(b.id, 'rejected')
  }
  // One tap used to cancel with no confirmation — the only destructive action
  // in the app that asked nothing. Now it says exactly what gets freed.
  const cancel = async (b) => {
    const ok = await confirm({
      title: 'Cancel this booking?',
      body: `Releases ${b.resource_name || 'the room'} · ${fmt(b.start_time, 'EEE, MMM d · h:mm a')}.`,
      confirmLabel: 'Cancel booking', cancelLabel: 'Keep it', danger: true,
    })
    if (ok) run(() => api.patch(`/bookings/${b.id}/cancel`), 'Booking cancelled')
  }

  return (
    <div>
      <div className="m-chips">
        {VISIBLE_STATUS.map(s => (
          <button key={s.key} className={`stat ${s.cls} ${filter === s.key ? 'is-on' : ''}`} onClick={() => setFilter(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {items === null ? <ListSkeleton /> :
        items.length === 0 ? <Empty text={filter ? `No ${filter} bookings.` : 'No bookings.'} /> :
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
            {items.map(b => (
              <button key={b.id} className="m-card m-eventrow" style={{ textAlign: 'left', borderLeft: '3px solid', borderLeftColor: accentVar(b.status) }} onClick={() => setSel(b)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.event_title || 'Booking'}</div>
                  <div className="m-muted" style={{ fontSize: '0.82rem' }}>{b.resource_name} · {fmt(b.start_time)}</div>
                </div>
                <span className={`statbadge ${clsOf(b.status)}`}>{labelOf(b.status)}</span>
              </button>
            ))}
          </div>}

      <SheetV3 open={!!sel} onClose={() => setSel(null)} title={sel?.event_title || 'Booking'}>
        {sel && (
          <>
            <DetailRow label="Resource" value={sel.resource_name || '—'} />
            <DetailRow label="When" value={`${fmt(sel.start_time, 'EEE, MMM d · h:mm a')} – ${fmt(sel.end_time, 'h:mm a')}`} />
            {isAdmin && <DetailRow label="Requested by" value={sel.requester_name || '—'} />}
            <DetailRow label="Status" value={labelOf(sel.status)} />
            {sel.notes && <DetailRow label="Notes" value={sel.notes} />}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, marginTop: 16 }}>
              {APPROVALS_ENABLED && isAdmin && sel.status === 'pending' && (
                <>
                  <Btn variant="primary" full loading={busy} onClick={() => review(sel.id, 'approved')}>Approve</Btn>
                  <Btn full disabled={busy} onClick={() => confirmReject(sel)}>Reject</Btn>
                </>
              )}
              {/* A repeating series' template booking has no meaningful "edit time"
                  here — moving it alone would slide every occurrence's room hold off
                  the class the calendar shows. The event editor owns that, because it
                  can ask whether you mean this occurrence, this and following, or all. */}
              {EDITABLE.includes(sel.status) && sel.is_recurring_template && (
                <p className="m-muted" style={{ fontSize: '0.82rem', margin: 0 }}>
                  Repeating event. Edit in calendar.
                </p>
              )}
              {EDITABLE.includes(sel.status) && !sel.is_recurring_template && (
                <Btn full onClick={() => { setEditing(sel); setSel(null) }}>Edit booking</Btn>
              )}
              {EDITABLE.includes(sel.status) && (
                <Btn variant="ghost" full onClick={() => cancel(sel)} style={{ color: 'var(--danger)' }}>Cancel booking</Btn>
              )}
            </div>
          </>
        )}
      </SheetV3>

      <EditBookingSheet booking={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} snack={snack} />
      {confirmEl}
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
    const tErr = timeRangeError(start, end)
    if (tErr) { setError(tErr); return }
    setLoading(true); setError('')
    try {
      const ns = toISO(date, start), ne = toISO(date, end)
      if (!ns || !ne) { setError('Pick a date and time first.'); setLoading(false); return }
      await api.patch(`/bookings/${booking.id}`, { start_time: ns, end_time: ne, notes })
      snack('Booking updated'); onDone()
    } catch (e) { setError(errText(e, 'That time may be busy.')) }
    finally { setLoading(false) }
  }
  return (
    <SheetV3 open={!!booking} onClose={onClose} title={`Edit · ${booking.resource_name || 'Booking'}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div><label className="m-label">Date</label>
          {/* same tap-to-jump calendar the rest of the app uses */}
          <div style={{ marginBottom: 12 }}>
            {/* `date` is '' until the open-effect fills it, so parse defensively —
                an Invalid Date here used to blank the screen. */}
            <DateJump day={date ? parseISO(`${date}T00:00`) : null} fmt="EEE, d MMM yyyy"
              onPick={(d) => setDate(format(d, 'yyyy-MM-dd'))} />
          </div>
          <TimeRange start={start} end={end} onChange={({ start: s, end: e }) => { setStart(s); setEnd(e) }} />
        </div>
        <div><label className="m-label">Notes</label>
          <input className="m-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" /></div>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={save}>Save changes</Btn>
      </div>
    </SheetV3>
  )
}
