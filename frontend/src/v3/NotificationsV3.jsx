import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, isToday, parseISO, format } from 'date-fns'
import { Bell, CheckCheck, Calendar, ArrowLeftRight, AlertTriangle, Info, ArrowUpRight } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { useAutoRefresh } from './useAutoRefresh'
import { publishUnread } from './unreadBus'

const iconFor = (n) => {
  const t = `${n.title || ''} ${n.type || ''}`.toLowerCase()
  if (t.includes('request') || t.includes('release') || t.includes('move')) return ArrowLeftRight
  if (t.includes('clash') || t.includes('conflict') || t.includes('reject')) return AlertTriangle
  if (t.includes('event') || t.includes('booking') || t.includes('approve')) return Calendar
  return Info
}
const ago = (s) => { try { return formatDistanceToNow(parseISO(s), { addSuffix: true }) } catch { return '' } }
const isFromToday = (s) => { try { return isToday(parseISO(s)) } catch { return false } }
// Exact time, shown only in the expanded row — the relative one is for scanning.
const stamp = (s) => { try { return format(parseISO(s), 'EEE d MMM, h:mm a') } catch { return '' } }

// Where a notification should take you when tapped.
// event_id  → open that event on the calendar
// booking.* → the Bookings list
// slot request (event_updated + a booking_id, no event_id) → Slot Requests
const targetFor = (n) => {
  if (n.event_id) return `/?event=${n.event_id}`
  const type = (n.type || '').toLowerCase()
  if (type.startsWith('booking')) return '/bookings'
  if (n.booking_id) return '/requests'
  return null
}

export function NotificationsV3() {
  const snack = useSnack()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)

  const load = useCallback((silent = false) => {
    if (!silent) setItems(null)
    api.get('/users/me/notifications').then(r => setItems(r.data)).catch(() => setItems(prev => prev || []))
  }, [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(() => load(true), 25000)

  // Keep the Activity tab's dot in step with this list. Watching `items` rather
  // than calling publishUnread() from each handler means every path is covered by
  // construction — mark-all, the per-row toggle in BOTH directions, a refetch, and
  // the revert after a failed request — with no handler left to forget.
  useEffect(() => {
    if (items) publishUnread(items.filter(n => !n.is_read).length)
  }, [items])

  const markAll = async () => {
    setItems(prev => (prev || []).map(n => ({ ...n, is_read: true })))
    try { await api.post('/users/me/notifications/read'); snack('All caught up') }
    catch { snack('Failed'); load(true) }
  }

  // Tap a notification → EXPAND it in place and mark it read. It used to navigate
  // away immediately, which meant the only way to read one was to leave the screen —
  // and then walk back to Activity for the next one. Worse, the destination was often
  // just the calendar, so you were moved somewhere for no reason you asked for.
  // Going somewhere is now a separate, labelled button inside the expanded row, so a
  // tap never does more than you meant by it.
  const [openId, setOpenId] = useState(null)
  const open = (n) => {
    setOpenId(cur => (cur === n.id ? null : n.id))
    if (!n.is_read) {
      setItems(prev => (prev || []).map(x => x.id === n.id ? { ...x, is_read: true } : x))
      api.post(`/users/me/notifications/${n.id}/read`).catch(() => {})
    }
  }
  // The explicit "go there" action. Only rendered when there IS somewhere to go, so
  // there is no longer a dead tap that answers with "Nothing more to open".
  const goTo = (e, n) => {
    e.stopPropagation()
    const to = targetFor(n)
    if (to) navigate(to)
  }

  // Explicit read/unread toggle (the dot doubles as the button).
  const toggleRead = (e, n) => {
    e.stopPropagation()
    const next = !n.is_read
    const set = (v) => setItems(prev => (prev || []).map(x => x.id === n.id ? { ...x, is_read: v } : x))
    set(next)
    // Put it back if the server refused. Swallowing the error left the row AND the
    // tab dot showing a state the server never accepted — and since the dot is now
    // driven from this list, a silent failure would have desynced both.
    api.post(`/users/me/notifications/${n.id}/${next ? 'read' : 'unread'}`)
      .catch(() => { set(!next); snack('Could not save that') })
  }

  const unread = (items || []).filter(n => !n.is_read)
  const today = (items || []).filter(n => isFromToday(n.created_at))
  const earlier = (items || []).filter(n => !isFromToday(n.created_at))

  const Row = (n) => {
    const Icon = iconFor(n)
    const isOpen = openId === n.id
    const to = targetFor(n)
    return (
      <div key={n.id} role="button" tabIndex={0} onClick={() => open(n)}
        aria-expanded={isOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') open(n) }}
        className={`v-notif ${n.is_read ? '' : 'v-notif--unread'}`} style={{ cursor: 'pointer' }}>
        <div className="v-notif__icon"><Icon size={17} /></div>
        <div className="v-notif__body">
          <div className="v-notif__top">
            <span className="v-notif__title">{n.title}</span>
            <span className="v-notif__time">{ago(n.created_at)}</span>
          </div>
          {/* collapsed: one clamped line. expanded: the whole thing, plus the exact
              timestamp — "2 days ago" is fine for scanning, useless for "when
              exactly did this land". */}
          {n.message && <div className={`v-notif__msg ${isOpen ? 'is-open' : ''}`}>{n.message}</div>}
          {isOpen && (
            <div className="v-notif__more">
              <span className="v-notif__stamp">{stamp(n.created_at)}</span>
              {to && (
                <button type="button" className="v-notif__go" onClick={(e) => goTo(e, n)}>
                  {to.startsWith('/bookings') ? 'View booking'
                    : to.startsWith('/requests') ? 'View request'
                      : 'Open event'}
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        <button onClick={(e) => toggleRead(e, n)}
          title={n.is_read ? 'Mark as unread' : 'Mark as read'}
          aria-label={n.is_read ? 'Mark as unread' : 'Mark as read'}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 44, minHeight: 44, flex: '0 0 auto', alignSelf: 'stretch' }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
            background: n.is_read ? 'transparent' : 'var(--brand)',
            border: n.is_read ? '1.5px solid var(--text-3)' : 'none',
          }} />
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* ALWAYS rendered, merely hidden when there is nothing to mark. Mounting it
          conditionally made the entire list jump by its height the instant the last
          unread notification was read — or the instant you marked one back to unread —
          which is a visual lurch in the exact spot you are trying to read.
          visibility:hidden reserves the space at its real height (no guessed min-height
          to drift out of sync) and takes the button out of the tab order and the
          accessibility tree, so it is not a phantom control while invisible. */}
      <button className="m-link" onClick={markAll}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, textDecoration: 'none',
          visibility: unread.length > 0 ? 'visible' : 'hidden',
        }}>
        <CheckCheck size={16} /> Mark all read ({unread.length})
      </button>

      {items === null ? <ListSkeleton h={62} /> :
        items.length === 0 ? <Empty icon="🔔" text="You're all caught up." /> :
          <>
            {today.length > 0 && <>
              <div className="v-notif-group">Today</div>
              <div className="v-notif-list">{today.map(Row)}</div>
            </>}
            {earlier.length > 0 && <>
              <div className="v-notif-group">Earlier</div>
              <div className="v-notif-list">{earlier.map(Row)}</div>
            </>}
          </>}
    </div>
  )
}
