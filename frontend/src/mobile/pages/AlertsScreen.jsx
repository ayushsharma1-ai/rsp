import React, { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import api from '../../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../ui'

const fmt = (s) => { try { return format(new Date(s), 'MMM d · HH:mm') } catch { return s } }

export function AlertsScreen() {
  const snack = useSnack()
  const [items, setItems] = useState(null)

  const load = useCallback(() => {
    setItems(null)
    api.get('/users/me/notifications').then(r => setItems(r.data)).catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])

  const markRead = async () => {
    try { await api.post('/users/me/notifications/read'); snack('Marked all read'); load() }
    catch (e) { snack('Failed') }
  }

  const unread = (items || []).filter(n => !n.is_read).length

  return (
    <div>
      {unread > 0 && <Btn full onClick={markRead} style={{ marginBottom: 12 }}>Mark all read ({unread})</Btn>}
      {items === null ? <ListSkeleton h={74} /> :
        items.length === 0 ? <Empty icon="🔔" text="No notifications yet." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {items.map(n => (
              <div key={n.id} className="m-card" style={{ borderColor: n.is_read ? 'var(--border)' : 'var(--brand)', opacity: n.is_read ? 0.65 : 1 }}>
                <div style={{ fontWeight: 600 }}>{n.title}</div>
                <div className="m-muted" style={{ fontSize: '0.85rem', marginTop: 2 }}>{n.message}</div>
                <div className="m-muted" style={{ fontSize: '0.72rem', marginTop: 6 }}>{fmt(n.created_at)}</div>
              </div>
            ))}
          </div>}
    </div>
  )
}
