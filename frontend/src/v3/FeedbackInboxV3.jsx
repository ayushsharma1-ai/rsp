import React, { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import api from '../lib/api'
import { ListSkeleton, Empty } from '../mobile/ui'

// Admin-only view of what users have submitted through the Feedback screen.
const CATS = [
  { key: '', label: 'All' },
  { key: 'bug', label: 'Bugs' },
  { key: 'idea', label: 'Ideas' },
  { key: 'other', label: 'Other' },
]

const fdate = (s) => { try { return format(parseISO(s), 'MMM d · HH:mm') } catch { return s } }

export function FeedbackInboxV3() {
  const [items, setItems] = useState(null)
  const [cat, setCat] = useState('')

  const load = useCallback(() => {
    api.get('/feedback').then(r => setItems(r.data)).catch(() => setItems([]))
  }, [])
  useEffect(() => { load() }, [load])

  const list = (items || []).filter(f => !cat || (f.category || '').toLowerCase() === cat)

  return (
    <div>
      <div className="m-chips">
        {CATS.map(c => (
          <button key={c.key} className={`m-chip ${cat === c.key ? 'm-chip--active' : ''}`}
            onClick={() => setCat(c.key)}>{c.label}</button>
        ))}
      </div>

      {items === null ? <ListSkeleton h={90} /> :
        list.length === 0 ? <Empty icon="📮" text="No feedback yet." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {list.map(f => (
              <div key={f.id} className="m-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  {f.category && <span className="m-badge">{f.category}</span>}
                  <span className="m-muted" style={{ fontSize: '0.78rem', marginLeft: 'auto' }}>
                    {fdate(f.submitted_at)}
                  </span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{f.message}</div>
                <div className="m-muted" style={{ fontSize: '0.78rem', marginTop: 8 }}>
                  {f.user_name || 'Unknown'}{f.user_role ? ` (${f.user_role})` : ''}
                  {f.page_name ? ` · from ${f.page_name}` : ''}
                </div>
                {f.browser && (
                  <div className="m-muted" style={{ fontSize: '0.72rem', marginTop: 2, wordBreak: 'break-all' }}>
                    {f.browser}
                  </div>
                )}
              </div>
            ))}
          </div>}
    </div>
  )
}
