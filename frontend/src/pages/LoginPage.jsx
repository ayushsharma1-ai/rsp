import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Btn, Field } from '../components/ui'

// Login only — no public sign-up. Admins add members (Users page). Only @iitk.ac.in.
const DOMAIN = 'iitk.ac.in'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) { setError('Enter your username.'); return }
    setLoading(true)
    try {
      await login(`${username.trim().toLowerCase()}@${DOMAIN}`, password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed — check your details.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo__mark">📅</span>
          <p className="auth-logo__sub">Resource Scheduling Platform</p>
        </div>

        <form onSubmit={submit} className="auth-form">
          <Field label="Email">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="firstname.lastname"
                autoComplete="username" autoCapitalize="none" autoCorrect="off" style={{ flex: 1 }} />
              <span style={{ color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap' }}>@{DOMAIN}</span>
            </div>
          </Field>

          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
          </Field>

          {error && <p className="auth-error">{error}</p>}

          <Btn type="submit" loading={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
            Sign In
          </Btn>
        </form>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text3)', marginTop: '1rem' }}>
          No account? Ask your department admin to add you.
        </p>
      </div>
    </div>
  )
}
