import React, { useEffect, useState } from 'react'
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

export default function NotificationsPage() {
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
    await api.post('/users/me/notifications/read')
    fetch()
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
            <div key={n.id} className={`notif-item ${!n.is_read ? 'notif-item--unread' : ''}`}>
              <div className="notif-icon">{TYPE_ICONS[n.type] || '🔔'}</div>
              <div className="notif-body">
                <p className="notif-title">{n.title}</p>
                <p className="notif-msg">{n.message}</p>
              </div>
              <div className="notif-meta">
                <span>{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</span>
                {!n.is_read && <span className="notif-dot" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
