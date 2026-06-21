import React, { createContext, useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'
import SheetV3 from './SheetV3'

const Ctx = createContext({ requireLogin: () => {} })
export const useAuthGate = () => useContext(Ctx)

// Wraps the app. `requireLogin(action)` runs `action` immediately if you're signed
// in; otherwise it pops a login sheet and runs `action` AFTER a successful sign-in —
// so you resume exactly what you were doing (no redirect, no lost context).
export function AuthGateProvider({ children }) {
  const { user } = useAuthStore()
  const [pending, setPending] = useState(null)   // null = closed; a function = sheet open

  const requireLogin = (action) => {
    const fn = typeof action === 'function' ? action : () => {}
    if (user) fn()
    else setPending(() => fn)                     // stash the action; open the sheet
  }
  const close = () => setPending(null)
  const onSuccess = () => { const fn = pending; setPending(null); if (typeof fn === 'function') fn() }

  return (
    <Ctx.Provider value={{ requireLogin }}>
      {children}
      <LoginSheet open={pending !== null} onClose={close} onSuccess={onSuccess} />
    </Ctx.Provider>
  )
}

function LoginSheet({ open, onClose, onSuccess }) {
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setEmail(''); setPassword(''); setError('') } }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setLoading(true); setError('')
    try { await login(email.trim(), password); onSuccess() }
    catch (err) { setError(err.response?.data?.detail || 'Login failed — check your details.') }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Sign in to continue">
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div className="m-muted" style={{ fontSize: '0.86rem', marginTop: -4 }}>
          Browsing the calendar is open to everyone — signing in lets you add and edit events.
        </div>
        <div>
          <label className="m-label">Email</label>
          <input className="m-input" type="email" autoComplete="email" value={email}
            onChange={e => setEmail(e.target.value)} placeholder="you@iitk.ac.in" autoFocus />
        </div>
        <div>
          <label className="m-label">Password</label>
          <input className="m-input" type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} type="submit">Sign in</Btn>
        <button type="button" className="m-link" style={{ textAlign: 'center' }}
          onClick={() => { onClose(); navigate('/login') }}>New here? Create an account</button>
      </form>
    </SheetV3>
  )
}
