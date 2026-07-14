import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'

// Login only — there is NO public sign-up. Accounts are created by an admin
// (Users → Add member), and only @iitk.ac.in emails are allowed.
const DOMAIN = 'iitk.ac.in'

export default function LoginV3() {
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')   // the part before @iitk.ac.in
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim()) { setError('Enter your username.'); return }
    setLoading(true)
    try {
      await login(`${username.trim().toLowerCase()}@${DOMAIN}`, password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed — check your details.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24, padding: 24 }}>
      <button type="button" onClick={() => navigate('/')} aria-label="Back to calendar"
        style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 14px)', left: 14, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 12, padding: '8px 13px 8px 9px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
        <ChevronLeft size={17} /> Calendar
      </button>

      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--grad-brand)', boxShadow: 'var(--glow-brand)', color: 'var(--on-accent)', fontFamily: 'Syne', fontWeight: 800, fontSize: '1.4rem', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>RSP</div>
        <h1 className="v-h" style={{ margin: 0, fontSize: '1.8rem' }}>Scheduler</h1>
        <p className="m-muted" style={{ margin: '4px 0 0' }}>Sign in with your institute account.</p>
      </div>

      <form className="m-card" style={{ display: 'grid', gap: 14 }} onSubmit={submit}>
        <div>
          <label className="m-label">Email</label>
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2 }}>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="firstname.lastname"
              autoComplete="username" autoCapitalize="none" autoCorrect="off"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '1rem', height: '46px' }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>@{DOMAIN}</span>
          </div>
        </div>
        <div>
          <label className="m-label">Password</label>
          <input className="m-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
        </div>

        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>Sign in</Btn>

        <p className="m-muted" style={{ fontSize: '0.8rem', textAlign: 'center', margin: '2px 0 0' }}>
          No account? Ask your department admin to add you.
        </p>
      </form>
    </div>
  )
}
