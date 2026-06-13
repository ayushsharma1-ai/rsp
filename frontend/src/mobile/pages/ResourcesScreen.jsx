import React, { useEffect, useState } from 'react'
import api from '../../lib/api'
import { ListSkeleton, Empty } from '../ui'

const TYPES = ['classroom', 'lab', 'computer_room', 'seminar_hall', 'meeting_room', 'equipment', 'other']
const TLAB = {
  classroom: 'Classroom', lab: 'Lab', computer_room: 'Computer Room', seminar_hall: 'Seminar Hall',
  meeting_room: 'Meeting Room', equipment: 'Equipment', other: 'Other',
}
const today = () => new Date().toISOString().slice(0, 10)

export function ResourcesScreen() {
  const [res, setRes] = useState(null)
  const [date, setDate] = useState(today())
  const [avail, setAvail] = useState({})
  const [q, setQ] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)

  useEffect(() => { api.get('/resources').then(r => setRes(r.data)).catch(() => setRes([])) }, [])
  useEffect(() => {
    api.get('/availability/day', { params: { date } })
      .then(r => { const m = {}; r.data.forEach(x => { m[x.id] = x }); setAvail(m) })
      .catch(() => {})
  }, [date])

  const filtered = (res || []).filter(r => {
    if (q && !(r.name || '').toLowerCase().includes(q.toLowerCase())) return false
    if (onlyFree && !avail[r.id]?.is_free) return false
    return true
  })

  return (
    <div>
      <input className="m-input" placeholder="Search rooms…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <input className="m-input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ flex: 1 }} />
        <label className="m-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={onlyFree} onChange={e => setOnlyFree(e.target.checked)} /> Free
        </label>
      </div>

      {res === null ? <ListSkeleton /> :
        filtered.length === 0 ? <Empty icon="🏛️" text="No rooms match." /> :
          TYPES.map(t => {
            const g = filtered.filter(r => r.resource_type === t)
            if (!g.length) return null
            return (
              <div key={t}>
                <p className="m-section-title">{TLAB[t]} ({g.length})</p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {g.map(r => {
                    const a = avail[r.id]
                    const color = a ? (a.is_free ? '#16a34a' : '#ea580c') : 'var(--text-3)'
                    return (
                      <div key={r.id} className="m-card m-eventrow">
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}><span className="m-dot" style={{ background: color }} />{r.name}</div>
                          {r.location && <div className="m-muted" style={{ fontSize: '0.8rem' }}>{r.location}</div>}
                        </div>
                        {r.capacity ? <span className="m-badge">{r.capacity} seats</span> : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
    </div>
  )
}
