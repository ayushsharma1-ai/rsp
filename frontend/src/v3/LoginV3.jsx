import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'

export default function LoginV3() {
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try { await login(email, password); navigate('/', { replace: true }) }
    catch (err) { setError(err.response?.data?.detail || 'Login failed') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24, padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--brand)', color: '#fff', fontFamily: 'Syne', fontWeight: 800, fontSize: '1.4rem', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>RSP</div>
        <h1 className="v-h" style={{ margin: 0, fontSize: '1.8rem' }}>Scheduler</h1>
        <p className="m-muted" style={{ margin: '4px 0 0' }}>Book rooms, labs and events.</p>
      </div>
      <form className="m-card" style={{ display: 'grid', gap: 14 }} onSubmit={submit}>
        <div>
          <label className="m-label">Email</label>
          <input className="m-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@rsp.edu" autoComplete="email" required />
        </div>
        <div>
          <label className="m-label">Password</label>
          <input className="m-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
        </div>
        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>Sign in</Btn>
        <p className="m-muted" style={{ fontSize: '0.78rem', textAlign: 'center', margin: '2px 0 0' }}>
          Admin: admin@rsp.edu · admin123<br />Faculty: vivek.kant@iitk.ac.in · vivek123
        </p>
      </form>
    </div>
  )
}
