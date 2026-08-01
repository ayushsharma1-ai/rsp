import React, { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import { Btn, useSnack } from '../ui'
import { errText } from '../lib'

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
  const [anonymous, setAnonymous] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!message.trim()) { setError('Please write a message.'); return }
    setLoading(true); setError('')
    try {
      // Capture the actual screen the user came from (the hash route), not a constant
      // "Mobile App" — otherwise every report says the same thing and admins can't tell
      // whether it's about the calendar, requests, rooms, etc.
      const route = (window.location.hash || '#/').replace(/^#/, '') || '/'
      await api.post('/feedback', {
        message, category, anonymous,
        page_url: route, page_name: route, browser: navigator.userAgent,
      })
      setDone(true); snack('Thanks for the feedback!'); setMessage('')
      setTimeout(() => setDone(false), 2500)
    } catch (e) { setError(errText(e, 'Failed to submit.')) }
    finally { setLoading(false) }
  }

  if (done) {
    return (
      <div className="m-card" style={{ textAlign: 'center', padding: '34px 16px' }}>
        <div style={{ fontSize: 34 }}>✓</div>
        <p style={{ marginBottom: 0 }}>Feedback sent. Thanks.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
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
          placeholder={category === 'bug' ? 'What happened?' : "What's on your mind?"} />
        <div className="m-muted" style={{ fontSize: '0.72rem', textAlign: 'right', marginTop: 4 }}>{message.length}/2000</div>
      </div>

      {/* The "who is this from" note lives WITH the checkbox now, not at the top,
          and its slot is a fixed height — toggling only swaps the words, so the
          page never jumps. */}
      <div>
        <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10, minHeight: 44 }}>
          <input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} />
          <span style={{ fontWeight: 500 }}>Send anonymously</span>
        </label>
        <p className="m-muted" style={{ margin: '6px 2px 0', fontSize: '0.8rem', lineHeight: 1.4, minHeight: '2.4em' }}>
          {anonymous
            ? <>Posted as <strong>Anonymous</strong>.</>
            : <>Posting as <strong>{user?.full_name}</strong>.</>}
        </p>
      </div>

      {error && <p className="m-error">{error}</p>}
      <Btn variant="primary" full loading={loading} onClick={submit}>Submit feedback</Btn>
    </div>
  )
}
