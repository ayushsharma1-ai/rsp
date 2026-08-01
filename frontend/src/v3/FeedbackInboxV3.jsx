import React, { useEffect, useState, useCallback } from 'react'
import { format, parseISO } from 'date-fns'
import api from '../lib/api'
import { ListSkeleton, Empty } from '../mobile/ui'

// Admin-only view of what users have submitted through the Feedback screen.
// Keys MUST match the backend FeedbackCategory enum (bug/suggestion/question/other).
// They didn't: the old "idea" key matched no stored value, so the Ideas filter always
// came up empty, and Questions had no filter at all.
const CATS = [
  { key: '', label: 'All' },
  { key: 'bug', label: 'Bugs' },
  { key: 'suggestion', label: 'Suggestions' },
  { key: 'question', label: 'Questions' },
  { key: 'other', label: 'Other' },
]

const fdate = (s) => { try { return format(parseISO(s), 'MMM d · h:mm a') } catch { return s } }
// "No feedback yet" under an active filter reads as an empty inbox; say which it is.

export function FeedbackInboxV3() {
  const [items, setItems] = useState(null)
  const [cat, setCat] = useState('')
  const [loadErr, setLoadErr] = useState(false)

  const load = useCallback(() => {
    setLoadErr(false)
    setItems(null)
    // On failure, distinguish a load ERROR from a genuinely empty inbox — the old code
    // set items to [] on error, so a failed request looked identical to "No feedback yet".
    api.get('/feedback').then(r => { setItems(r.data); setLoadErr(false) })
      .catch(() => { setItems([]); setLoadErr(true) })
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
        loadErr ? (
          <div className="m-card" style={{ textAlign: 'center', padding: '28px 16px' }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>⚠️</div>
            <p className="m-muted" style={{ margin: '0 0 12px' }}>Couldn’t load feedback.</p>
            <button className="m-chip" onClick={load}>Retry</button>
          </div>
        ) :
        list.length === 0 ? <Empty icon="📮" text={cat && items.length ? 'Nothing in this category.' : 'No feedback yet.'} /> :
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
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
