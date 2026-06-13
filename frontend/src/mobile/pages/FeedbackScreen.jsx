import React, { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import { Btn, useSnack } from '../ui'

const CATEGORIES = [
  { value: 'bug', label: '🐛 Bug' },
  { value: 'suggestion', label: '💡 Suggestion' },
  { value: 'question', label: '❓ Question' },
  { value: 'other', label: '💬 Other' },
]

export function FeedbackScreen() {
  const snack = useSnack()
  const { user } = useAuthStore()
  const [category, setCategory] = useState('other')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!message.trim()) { setError('Please write a message.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/feedback', {
        message, category, page_url: '/mobile', page_name: 'Mobile App', browser: navigator.userAgent,
      })
      setDone(true); snack('Thanks for the feedback!'); setMessage('')
      setTimeout(() => setDone(false), 2500)
    } catch (e) { setError(e.response?.data?.detail || 'Failed to submit.') }
    finally { setLoading(false) }
  }

  if (done) {
    return (
      <div className="m-card" style={{ textAlign: 'center', padding: '34px 16px' }}>
        <div style={{ fontSize: 34 }}>✓</div>
        <p style={{ marginBottom: 0 }}>Thank you! Your feedback was submitted.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <p className="m-muted" style={{ margin: 0, fontSize: '0.88rem' }}>Submitting as <strong>{user?.full_name}</strong></p>

      <div>
        <label className="m-label">Category</label>
        <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible', margin: 0, padding: 0 }}>
          {CATEGORIES.map(c => (
            <button key={c.value} type="button" className={`m-chip ${category === c.value ? 'm-chip--active' : ''}`}
              onClick={() => setCategory(c.value)}>{c.label}</button>
          ))}
        </div>
      </div>

      <div>
        <label className="m-label">Message</label>
        <textarea className="m-input" rows={5} style={{ paddingTop: 12, height: 'auto' }} maxLength={2000}
          value={message} onChange={e => setMessage(e.target.value)}
          placeholder={category === 'bug' ? 'What happened? What did you expect?' : "What's on your mind?"} />
        <div className="m-muted" style={{ fontSize: '0.72rem', textAlign: 'right', marginTop: 4 }}>{message.length}/2000</div>
      </div>

      {error && <p className="m-error">{error}</p>}
      <Btn variant="primary" full loading={loading} onClick={submit}>Submit feedback</Btn>
    </div>
  )
}
