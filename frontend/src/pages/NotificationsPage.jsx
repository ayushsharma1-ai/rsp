import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { PageHeader, Card, Btn, Empty, Spinner } from '../components/ui'
import { formatDistanceToNow } from 'date-fns'
import { Bell, CheckCheck } from 'lucide-react'

const TYPE_ICONS = {
  booking_confirmed: '✅',
  booking_rejected: '❌',
  booking_pending: '⏳',
  booking_cancelled: '🚫',
  event_updated: '📅',
  event_cancelled: '❌',
  reminder: '🔔',
}

// Where a notification leads when clicked.
const targetFor = (n) => {
  if (n.event_id) return `/calendar?event=${n.event_id}`
  const type = (n.type || '').toLowerCase()
  if (type.startsWith('booking')) return '/bookings'
  if (n.booking_id) return '/requests'   // slot-release notifications
  return null
}

export default function NotificationsPage() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = () => {
    setLoading(true)
    api.get('/users/me/notifications')
      .then(r => setNotifications(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetch() }, [])

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    try { await api.post('/users/me/notifications/read') } catch { fetch() }
  }

  // Click a notification → auto-mark read, then deep-link to its subject.
  const open = (n) => {
    if (!n.is_read) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      api.post(`/users/me/notifications/${n.id}/read`).catch(() => {})
    }
    const to = targetFor(n)
    if (to) navigate(to)
  }

  // Explicit read/unread toggle (the dot is the button).
  const toggleRead = (e, n) => {
    e.stopPropagation()
    const next = !n.is_read
    setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: next } : x))
    api.post(`/users/me/notifications/${n.id}/${next ? 'read' : 'unread'}`).catch(() => {})
  }

  const unread = notifications.filter(n => !n.is_read).length

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        action={unread > 0 && (
          <Btn variant="ghost" onClick={markAllRead}><CheckCheck size={16} /> Mark all read</Btn>
        )}
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : notifications.length === 0 ? (
        <Empty icon={<Bell size={32} />} title="No notifications" subtitle="You'll see booking updates and reminders here." />
      ) : (
        <div className="notif-list">
          {notifications.map(n => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => open(n)}
              onKeyDown={(e) => { if (e.key === 'Enter') open(n) }}
              className={`notif-item ${!n.is_read ? 'notif-item--unread' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              <div className="notif-icon">{TYPE_ICONS[n.type] || '🔔'}</div>
              <div className="notif-body">
                <p className="notif-title">{n.title}</p>
                <p className="notif-msg">{n.message}</p>
              </div>
              <div className="notif-meta">
                <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                <button
                  onClick={(e) => toggleRead(e, n)}
                  title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                  aria-label={n.is_read ? 'Mark as unread' : 'Mark as read'}
                  style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%', display: 'inline-block',
                    background: n.is_read ? 'transparent' : 'var(--accent, #5b6ef5)',
                    border: n.is_read ? '1.5px solid var(--text3, #94a3b8)' : 'none',
                  }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
