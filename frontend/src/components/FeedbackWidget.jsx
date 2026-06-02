import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import api from '../lib/api'
import { Modal, Field, Btn } from './ui'
import { MessageSquare } from 'lucide-react'

// Maps URL paths to human-readable page names
const PAGE_NAMES = {
  '/':              'Dashboard',
  '/calendar':      'Calendar',
  '/bookings':      'Bookings',
  '/resources':     'Resources',
  '/notifications': 'Notifications',
  '/users':         'Users',
}

export default function FeedbackWidget() {
  const location = useLocation()
  const { user } = useAuthStore()
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState({ message: '', category: 'other' })
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)
  const [error, setError]     = useState('')

  const pageName = PAGE_NAMES[location.pathname] || location.pathname
  const set      = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async e => {
    e.preventDefault()
    if (!form.message.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/feedback', {
        message:   form.message,
        category:  form.category,
        page_url:  location.pathname,
        page_name: pageName,
        browser:   navigator.userAgent,
      })
      setDone(true)
      setTimeout(() => {
        setDone(false)
        setOpen(false)
        setForm({ message: '', category: 'other' })
      }, 2000)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to submit feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button — bottom right of every page */}
      <button
        className="feedback-fab"
        onClick={() => setOpen(true)}
        title="Send feedback"
      >
        <MessageSquare size={18} />
        <span>Feedback</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Send Feedback" width={440}>
        {done ? (
          <div className="feedback-success">
            <div className="feedback-success__icon">✓</div>
            <p>Thank you! Your feedback was submitted.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="form-grid">
            {/* Context shown to user — they see what metadata is captured */}
            <div className="feedback-context">
              <span>📍 Page: <strong>{pageName}</strong></span>
              {user && <span>👤 Submitting as: <strong>{user.full_name}</strong></span>}
            </div>

            <Field label="Category">
              <select value={form.category} onChange={set('category')}>
                <option value="bug">🐛 Bug — something is broken</option>
                <option value="suggestion">💡 Suggestion — I have an idea</option>
                <option value="question">❓ Question — I need help</option>
                <option value="other">💬 Other</option>
              </select>
            </Field>

            <Field label="Describe the issue or suggestion">
              <textarea
                value={form.message}
                onChange={set('message')}
                placeholder={
                  form.category === 'bug'
                    ? "What happened? What did you expect to happen?"
                    : form.category === 'suggestion'
                    ? "Describe your idea..."
                    : "What's on your mind?"
                }
                rows={4}
                required
                maxLength={2000}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: '0.25rem', textAlign: 'right' }}>
                {form.message.length}/2000
              </p>
            </Field>

            {error && <p className="form-error">{error}</p>}

            <div className="form-actions">
              <Btn type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Btn>
              <Btn type="submit" loading={loading}>
                Submit Feedback
              </Btn>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}