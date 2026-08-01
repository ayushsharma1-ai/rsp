import React, { createContext, useContext, useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'
import SheetV3 from './SheetV3'
import { errText } from '../mobile/lib'

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
    // Accept a full e-mail as typed (LoginV3 already does). The bootstrap admin is
    // NOT on the institute domain, so hard-appending it locked them out of this
    // sheet entirely — and the resulting 422 used to blank the page.
    const raw = username.trim()
    const email = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}@${DOMAIN}`
    try { await login(email, password); onSuccess() }
    catch (err) { setError(errText(err, 'Login failed — check your details.')) }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Sign in to continue">
      {/* minmax(0,1fr) — see LoginV3: without it, scaled system fonts push the
          non-wrapping domain suffix outside the sheet. */}
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
        <div className="m-muted" style={{ fontSize: '0.86rem', marginTop: -4 }}>
          Sign in to add or edit.
        </div>
        <div>
          <label className="m-label">Email</label>
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2, minWidth: 0, overflow: 'hidden' }}>
            {/* No placeholder — see LoginV3: "firstname.lastname" is not the
                institute's username format and misled people. */}
            <input value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" autoCorrect="off"
              style={{ flex: '1 1 0', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '1rem', height: '46px' }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>@{DOMAIN}</span>
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
