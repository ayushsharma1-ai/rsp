import React, { useEffect, useState, useCallback } from 'react'
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

export function NotificationsV3() {
  const snack = useSnack()
  const [items, setItems] = useState(null)

  const load = useCallback((silent = false) => {
    if (!silent) setItems(null)
    api.get('/users/me/notifications').then(r => setItems(r.data)).catch(() => setItems(prev => prev || []))
  }, [])
  useEffect(() => { load() }, [load])
  useAutoRefresh(() => load(true), 25000)

  const markAll = async () => {
    try { await api.post('/users/me/notifications/read'); snack('All caught up'); load() }
    catch { snack('Failed') }
  }

  const unread = (items || []).filter(n => !n.is_read)
  const today = (items || []).filter(n => isFromToday(n.created_at))
  const earlier = (items || []).filter(n => !isFromToday(n.created_at))

  const Row = (n) => {
    const Icon = iconFor(n)
    return (
      <div key={n.id} className={`v-notif ${n.is_read ? '' : 'v-notif--unread'}`}>
        <div className="v-notif__icon"><Icon size={17} /></div>
        <div className="v-notif__body">
          <div className="v-notif__top">
            <span className="v-notif__title">{n.title}</span>
            <span className="v-notif__time">{ago(n.created_at)}</span>
          </div>
          {n.message && <div className="v-notif__msg">{n.message}</div>}
        </div>
        {!n.is_read && <span className="v-notif__dot" />}
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
