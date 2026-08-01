import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ArrowLeftRight, MessageSquare, LogOut, ChevronRight, GraduationCap, Users, KeyRound, DoorOpen, Tag, Inbox, Moon, Sun } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { haptic, useTheme } from '../mobile/theme'
import { Btn, useSnack } from '../mobile/ui'
import api from '../lib/api'
import SheetV3 from './SheetV3'
import { errText } from '../mobile/lib'

function Row({ icon: Icon, label, onClick, danger }) {
  return (
    <button className={`m-card m-listbtn ${danger ? 'm-listbtn--danger' : ''}`} onClick={() => { haptic(); onClick() }}>
      <Icon size={20} />
      <span>{label}</span>
      <ChevronRight size={18} style={{ marginLeft: 'auto', opacity: 0.4 }} />
    </button>
  )
}

export function SettingsV3() {
  const { user, logout } = useAuthStore()
  const nav = useNavigate()
  const snack = useSnack()
  const isAdmin = user?.role === 'admin'
  const [pwOpen, setPwOpen] = useState(false)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
      <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="m-avatar">{(user?.full_name || '?')[0]?.toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{user?.full_name}</div>
          <div className="m-muted" style={{ fontSize: '0.82rem', overflowWrap: 'anywhere' }}>{user?.email}</div>
          <span className="m-badge" style={{ marginTop: 6 }}>{user?.role}</span>
        </div>
      </div>

      {/* theme lives HERE now, not in the top bar — the calendar page carries
          navigation and content only */}
      <ThemeRow />

      <Row icon={BookOpen} label="Bookings" onClick={() => nav('/bookings')} />
      <Row icon={ArrowLeftRight} label="Slot requests" onClick={() => nav('/requests')} />
      {isAdmin && <Row icon={GraduationCap} label="Groups" onClick={() => nav('/groups')} />}
      {isAdmin && <Row icon={Users} label="Users" onClick={() => nav('/users')} />}
      {isAdmin && <Row icon={DoorOpen} label="Rooms" onClick={() => nav('/rooms')} />}
      {isAdmin && <Row icon={Tag} label="Event kinds" onClick={() => nav('/kinds')} />}
      {isAdmin && <Row icon={Inbox} label="Feedback inbox" onClick={() => nav('/feedback-inbox')} />}
      <Row icon={KeyRound} label="Change password" onClick={() => setPwOpen(true)} />
      <Row icon={MessageSquare} label="Feedback" onClick={() => nav('/feedback')} />
      <Row icon={LogOut} label="Log out" onClick={logout} danger />

      <ChangePasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} snack={snack} />
    </div>
  )
}

// Dark/light toggle as a settings row — shows the CURRENT state and flips on tap.
function ThemeRow() {
  const [theme, toggle] = useTheme()
  const dark = theme === 'dark'
  return (
    <button className="m-card m-listbtn m-listbtn--switch" onClick={() => { haptic(); toggle() }}
      role="switch" aria-checked={dark} aria-label="Dark mode">
      {dark ? <Moon size={20} /> : <Sun size={20} />}
      <span>Dark mode</span>
      <span className={`v-switch ${dark ? 'v-switch--on' : ''}`} style={{ marginLeft: 'auto' }} aria-hidden="true">
        <span className="v-switch__knob" />
      </span>
    </button>
  )
}

// Self-service password change. Requires the current password, so someone who
// walks up to an unlocked session still can't silently take the account over.
function ChangePasswordSheet({ open, onClose, snack }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setCur(''); setNext(''); setConfirm(''); setError('') }
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (next.length < 8) { setError('Min 8 characters.'); return }
    if (next !== confirm) { setError('Passwords don’t match.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/users/me/password', { current_password: cur, new_password: next })
      snack('Password changed')
      onClose()
    } catch (err) {
      setError(errText(err, 'Couldn’t save. Retry.'))
    } finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Change password">
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div>
          <label className="m-label">Current password</label>
          <input className="m-input" type="password" value={cur} onChange={e => setCur(e.target.value)}
            autoComplete="current-password" />
        </div>
        <div>
          <label className="m-label">New password</label>
          <input className="m-input" type="password" value={next} onChange={e => setNext(e.target.value)}
            autoComplete="new-password" />
        </div>
        <div>
          <label className="m-label">Confirm new password</label>
          <input className="m-input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            autoComplete="new-password" />
        </div>
        <div className="m-muted" style={{ fontSize: '0.78rem' }}>At least 8 characters.</div>
        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>Save</Btn>
      </form>
    </SheetV3>
  )
}
