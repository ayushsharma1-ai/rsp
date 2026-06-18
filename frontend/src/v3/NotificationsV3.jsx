import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDistanceToNow, isToday, parseISO } from 'date-fns'
import { Bell, CheckCheck, Calendar, ArrowLeftRight, AlertTriangle, Info } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { useAutoRefresh } from './useAutoRefresh'

const iconFor = (n) => {
  const t = `${n.title || ''} ${n.type || ''}`.toLowerCase()
  if (t.includes('request') || t.includes('release') || t.includes('move')) return ArrowLeftRight
  if (t.includes('clash') || t.includes('conflict') || t.includes('reject')) return AlertTriangle
  if (t.includes('event') || t.includes('booking') || t.includes('approve')) return Calendar
  return Info
}
const ago = (s) => { try { return formatDistanceToNow(parseISO(s), { addSuffix: true }) } catch { return '' } }
const isFromToday = (s) => { try { return isToday(parseISO(s)) } catch { return false } }

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

  const markAll = async () => {
    setItems(prev => (prev || []).map(n => ({ ...n, is_read: true })))
    try { await api.post('/users/me/notifications/read'); snack('All caught up') }
    catch { snack('Failed'); load(true) }
  }

  // Tap a notification → auto-mark read, then deep-link to its subject.
  const open = (n) => {
    if (!n.is_read) {
      setItems(prev => (prev || []).map(x => x.id === n.id ? { ...x, is_read: true } : x))
      api.post(`/users/me/notifications/${n.id}/read`).catch(() => {})
    }
    const to = targetFor(n)
    if (to) navigate(to)
    else snack('Nothing more to open')
  }

  // Explicit read/unread toggle (the dot doubles as the button).
  const toggleRead = (e, n) => {
    e.stopPropagation()
    const next = !n.is_read
    setItems(prev => (prev || []).map(x => x.id === n.id ? { ...x, is_read: next } : x))
    api.post(`/users/me/notifications/${n.id}/${next ? 'read' : 'unread'}`).catch(() => {})
  }

  const unread = (items || []).filter(n => !n.is_read)
  const today = (items || []).filter(n => isFromToday(n.created_at))
  const earlier = (items || []).filter(n => !isFromToday(n.created_at))

  const Row = (n) => {
    const Icon = iconFor(n)
    return (
      <div key={n.id} role="button" tabIndex={0} onClick={() => open(n)}
        onKeyDown={(e) => { if (e.key === 'Enter') open(n) }}
        className={`v-notif ${n.is_read ? '' : 'v-notif--unread'}`} style={{ cursor: 'pointer' }}>
        <div className="v-notif__icon"><Icon size={17} /></div>
        <div className="v-notif__body">
          <div className="v-notif__top">
            <span className="v-notif__title">{n.title}</span>
            <span className="v-notif__time">{ago(n.created_at)}</span>
          </div>
          {n.message && <div className="v-notif__msg">{n.message}</div>}
        </div>
        <button onClick={(e) => toggleRead(e, n)}
          title={n.is_read ? 'Mark as unread' : 'Mark as read'}
          aria-label={n.is_read ? 'Mark as unread' : 'Mark as read'}
          style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
            background: n.is_read ? 'transparent' : 'var(--accent, #5b6ef5)',
            border: n.is_read ? '1.5px solid var(--text-3, #94a3b8)' : 'none',
          }} />
        </button>
      </div>
    )
  }

  return (
    <div>
      {unread.length > 0 && (
        <button className="m-link" onClick={markAll} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, textDecoration: 'none' }}>
          <CheckCheck size={16} /> Mark all read ({unread.length})
        </button>
      )}

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
