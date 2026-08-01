import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CalendarDays } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { Btn } from '../mobile/ui'
import { errText } from '../mobile/lib'
import { useKeyboardFit } from './useKeyboardFit'

// Login only — there is NO public sign-up. Accounts are created by an admin
// (Users → Add member), and only @iitk.ac.in emails are allowed.
const DOMAIN = 'iitk.ac.in'

export default function LoginV3() {
  // iOS: keep the password field above the on-screen keyboard (nothing else on
  // this screen can scroll, so without this it is simply unreachable).
  const kbFit = useKeyboardFit()
  const { login } = useAuthStore()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')   // the part before @iitk.ac.in
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Set by api.js when a silent token refresh fails — tell the user WHY they're
  // back here instead of leaving them to wonder where their session went.
  const [expired] = useState(() => {
    const f = sessionStorage.getItem('rsp-session-expired') === '1'
    sessionStorage.removeItem('rsp-session-expired')
    return f
  })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const raw = username.trim()
    if (!raw) { setError('Enter your username.'); return }
    // If they typed a full email (contains @), send it as-is. An admin bootstrapped
    // on another domain — or the seed admin@rsp.edu — has no @iitk.ac.in address and
    // could otherwise never sign in. Plain usernames still get the institute domain.
    const email = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}@${DOMAIN}`
    setLoading(true)
    try {
      await login(email, password)
      navigate('/', { replace: true })
    } catch (err) {
      if (err.response?.status === 429) {
        // slowapi's 429 body uses the `error` key, not `detail`, so the generic line
        // below would mislead the user into re-checking a correct password. Be specific.
        setError('Too many attempts. Wait a minute.')
      } else {
        setError(errText(err, 'Login failed — check your details.'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={kbFit} style={{ position: 'relative', minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 24, padding: 24 }}>
      {/* Says what it does: browse the PUBLIC calendar without signing in. The old
          bare "< Calendar" label read as "go back", and people who tapped it felt
          stranded on a signed-out screen they didn't ask for (audit, item 1). */}
      <button type="button" onClick={() => navigate('/')} aria-label="Browse the calendar without signing in"
        style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 14px)', left: 14, display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 40, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 12, padding: '8px 13px 8px 9px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
        <ChevronLeft size={17} /> Browse calendar
      </button>

      <div style={{ textAlign: 'center', width: '100%', maxWidth: 460 }}>
        {/* calendar glyph rather than initials — the app carries no brand name */}
        <div style={{ width: 64, height: 64, borderRadius: 18, background: 'var(--grad-brand)', boxShadow: 'var(--glow-brand)', color: 'var(--on-accent)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
          <CalendarDays size={30} />
        </div>
        <h1 className="v-h" style={{ margin: 0, fontSize: '1.8rem' }}>Scheduler</h1>
        <p className="m-muted" style={{ margin: '4px 0 0' }}>Sign in with your institute account.</p>
      </div>

      {/* minmax(0,1fr): grid items default to min-width:auto and refuse to shrink
          below their content, so with Android/iOS font scaling the non-wrapping
          "@iitk.ac.in" suffix pushed the whole row outside the card. */}
      <form className="m-card" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)', width: '100%', maxWidth: 460 }} onSubmit={submit}>
        {expired && (
          <div className="m-warn" style={{ fontSize: '0.84rem' }}>
            Session expired. Sign in again.
          </div>
        )}
        <div>
          <label className="m-label">Email</label>
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2, minWidth: 0, overflow: 'hidden' }}>
            {/* No placeholder. It read "firstname.lastname", which is not the
                institute's format — real usernames are short forms like stroy or
                vkant, so the hint actively misled people into typing an address
                that does not exist. The "@iitk.ac.in" suffix pinned to the right
                of this field already says what belongs here. */}
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" autoCorrect="off"
              style={{ flex: '1 1 0', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '1rem', height: '46px' }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap', flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>@{DOMAIN}</span>
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
