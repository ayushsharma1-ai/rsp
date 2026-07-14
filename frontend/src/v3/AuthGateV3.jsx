import React, { createContext, useContext, useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'
import SheetV3 from './SheetV3'

const DOMAIN = 'iitk.ac.in'

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
  const [username, setUsername] = useState('')   // the part before @iitk.ac.in
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setUsername(''); setPassword(''); setError('') } }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Enter your username and password.'); return }
    setLoading(true); setError('')
    try { await login(`${username.trim().toLowerCase()}@${DOMAIN}`, password); onSuccess() }
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
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2 }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="firstname.lastname"
              autoComplete="username" autoCapitalize="none" autoCorrect="off" autoFocus
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '1rem', height: '46px' }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>@{DOMAIN}</span>
          </div>
        </div>
        <div>
          <label className="m-label">Password</label>
          <input className="m-input" type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} type="submit">Sign in</Btn>
        <p className="m-muted" style={{ fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>
          No account? Ask your department admin to add you.
        </p>
      </form>
    </SheetV3>
  )
}
