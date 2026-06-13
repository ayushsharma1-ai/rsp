import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { CalendarDays, DoorOpen, Plus } from 'lucide-react'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import { Skeleton } from '../ui'
import { haptic } from '../theme'
import EventCreateSheet from '../EventCreateSheet'

const fmt = (s, f = 'EEE, MMM d · HH:mm') => { try { return format(new Date(s), f) } catch { return s } }

export default function HomeScreen() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [events, setEvents] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = () => api.get('/events').then(r => setEvents(r.data)).catch(() => setEvents([]))
  useEffect(() => { load() }, [])

  const upcoming = (events || [])
    .filter(e => new Date(e.start_time) >= new Date(Date.now() - 3600e3))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 5)

  const firstName = (user?.full_name || '').split(' ')[0] || 'there'

  return (
    <div>
      <h2 className="m-h" style={{ margin: '4px 2px 2px', fontSize: '1.6rem' }}>Hi, {firstName} 👋</h2>
      <p className="m-muted" style={{ margin: '0 2px 16px' }}>Here's your schedule at a glance.</p>

      <div className="m-stat-grid">
        <button className="m-card m-action" onClick={() => navigate('/calendar')}>
          <CalendarDays size={22} /><span style={{ fontWeight: 600 }}>Calendar</span>
        </button>
        <button className="m-card m-action" onClick={() => navigate('/bookings')}>
          <DoorOpen size={22} /><span style={{ fontWeight: 600 }}>My bookings</span>
        </button>
      </div>

      <p className="m-section-title">Upcoming</p>
      {events === null ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <Skeleton h={66} /><Skeleton h={66} /><Skeleton h={66} />
        </div>
      ) : upcoming.length === 0 ? (
        <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-2)' }}>
          No upcoming events.<br />Tap <strong>Calendar</strong> to book one.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {upcoming.map(e => (
            <div key={e.id} className="m-card m-eventrow">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                <div className="m-muted" style={{ fontSize: '0.82rem' }}>
                  {fmt(e.start_time)} – {fmt(e.end_time, 'HH:mm')}
                </div>
              </div>
              <span className="m-badge">{e.status}</span>
            </div>
          ))}
        </div>
      )}

      <button className="m-fab" onClick={() => { haptic(); setCreating(true) }} aria-label="New event"><Plus size={24} /></button>
      <EventCreateSheet open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} />
    </div>
  )
}
