import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'

// Roles a self-registering user may pick. 'admin' is intentionally excluded so
// nobody can grant themselves admin from the public sign-up form.
const ROLES = [
  { value: 'professor', label: 'Professor / Faculty' },
  { value: 'staff', label: 'Staff' },
  { value: 'viewer', label: 'Viewer (read-only)' },
]

export default function LoginV3() {
  const { login, register } = useAuthStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')        // 'login' | 'register'
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('professor')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isRegister = mode === 'register'

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (isRegister && !fullName.trim()) { setError('Please enter your name.'); return }
    setLoading(true)
    try {
      if (isRegister) {
        await register(email.trim(), fullName.trim(), password, role)
      } else {
        await login(email.trim(), password)
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.response?.data?.detail || (isRegister ? 'Could not create account.' : 'Login failed.'))
    } finally {
      setLoading(false)
    }
  }

  const switchMode = () => { setMode(isRegister ? 'login' : 'register'); setError('') }

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24, padding: 24 }}>
      <button type="button" onClick={() => navigate('/')} aria-label="Back to calendar"
        style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 14px)', left: 14, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 12, padding: '8px 13px 8px 9px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
        <ChevronLeft size={17} /> Calendar
      </button>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--grad-brand)', boxShadow: 'var(--glow-brand)', color: 'var(--on-accent)', fontFamily: 'Syne', fontWeight: 800, fontSize: '1.4rem', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>RSP</div>
        <h1 className="v-h" style={{ margin: 0, fontSize: '1.8rem' }}>Scheduler</h1>
        <p className="m-muted" style={{ margin: '4px 0 0' }}>{isRegister ? 'Create your account.' : 'Book rooms, labs and events.'}</p>
      </div>

      <form className="m-card" style={{ display: 'grid', gap: 14 }} onSubmit={submit}>
        {isRegister && (
          <div>
            <label className="m-label">Full name</label>
            <input className="m-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Dr. Jane Doe" autoComplete="name" required />
          </div>
        )}
        <div>
          <label className="m-label">Email</label>
          <input className="m-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@iitk.ac.in" autoComplete="email" required />
        </div>
        <div>
          <label className="m-label">Password</label>
          <input className="m-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={isRegister ? 'new-password' : 'current-password'} required />
        </div>
        {isRegister && (
          <div>
            <label className="m-label">Role</label>
            <select className="m-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        )}

        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>{isRegister ? 'Create account' : 'Sign in'}</Btn>

        <button type="button" className="m-link" onClick={switchMode} style={{ textAlign: 'center', marginTop: 2 }}>
          {isRegister ? 'Have an account? Sign in' : 'New here? Create an account'}
        </button>

        {/* {!isRegister && (
          <p className="m-muted" style={{ fontSize: '0.78rem', textAlign: 'center', margin: '2px 0 0' }}>
            Admin: admin@rsp.edu · admin123
          </p>
        )} */}
      </form>
    </div>
  )
}
