import React, { useEffect, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'

const ROLES = ['admin', 'professor', 'staff', 'viewer']
const DOMAIN = 'iitk.ac.in'

// Shared by "Add member" and "Reset password". Avoids look-alike characters (0/O, 1/l).
const randomPassword = (n = 12) => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let p = ''
  for (let i = 0; i < n; i++) p += a[Math.floor(Math.random() * a.length)]
  return p
}

export function UsersV3() {
  const snack = useSnack()
  const [users, setUsers] = useState(null)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => { api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([])) }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <Btn variant="primary" full onClick={() => { haptic(); setAdding(true) }} style={{ marginBottom: 12 }}>
        <Plus size={18} /> Add member
      </Btn>

      {users === null ? <ListSkeleton h={72} /> :
        users.length === 0 ? <Empty icon="🧑‍💼" text="No users found." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {users.map(u => (
              <button key={u.id} className="m-card m-eventrow" style={{ textAlign: 'left' }} onClick={() => { haptic(); setEditing(u) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div className="m-avatar" style={{ width: 40, height: 40, fontSize: '0.95rem' }}>{(u.full_name || '?')[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name}</div>
                    <div className="m-muted" style={{ fontSize: '0.8rem' }}>{u.email}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span className="m-badge">{u.role}</span>
                  {!u.is_active && <span className="m-badge" style={{ color: 'var(--danger)' }}>inactive</span>}
                </div>
              </button>
            ))}
          </div>}

      <EditUserSheet user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} snack={snack} />
      <AddMemberSheet open={adding} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load() }} snack={snack} />
    </div>
  )
}

function AddMemberSheet({ open, onClose, onCreated, snack }) {
  const [username, setUsername] = useState('')   // part before @iitk.ac.in
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('professor')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setUsername(''); setFullName(''); setRole('professor'); setPassword(''); setError('') }
  }, [open])

  const genPassword = () => setPassword(randomPassword(12))

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim()) { setError('Enter a username.'); return }
    if (!fullName.trim()) { setError('Enter the full name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/users', {
        email: `${username.trim().toLowerCase()}@${DOMAIN}`,
        full_name: fullName.trim(), role, password,
      })
      snack('Member added')
      onCreated()
    } catch (err) { setError(err.response?.data?.detail || 'Could not add member.') }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Add member">
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div>
          <label className="m-label">Email</label>
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2 }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="firstname.lastname"
              autoCapitalize="none" autoCorrect="off"
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text)', fontSize: '1rem', height: '46px' }} />
            <span style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>@{DOMAIN}</span>
          </div>
        </div>
        <div><label className="m-label">Full name</label>
          <input className="m-input" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Dr. Jane Doe" /></div>
        <div><label className="m-label">Role</label>
          <select className="m-input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select></div>
        <div>
          <label className="m-label">Initial password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="m-input" value={password} onChange={e => setPassword(e.target.value)} placeholder="Set a password" style={{ flex: 1 }} />
            <Btn type="button" onClick={genPassword}>Generate</Btn>
          </div>
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6 }}>Share this with the member — they'll use it to sign in.</div>
        </div>
        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>Add member</Btn>
      </form>
    </SheetV3>
  )
}

function EditUserSheet({ user, onClose, onSaved, snack }) {
  const [role, setRole] = useState('viewer')
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMsg, setPwMsg] = useState('')
  useEffect(() => {
    if (user) { setRole(user.role); setActive(user.is_active); setError(''); setNewPw(''); setPwMsg('') }
  }, [user])
  if (!user) return null

  const resetPw = async () => {
    if (newPw.length < 8) { setPwMsg('Password must be at least 8 characters.'); return }
    setPwLoading(true); setPwMsg('')
    try {
      await api.post(`/users/${user.id}/password`, { new_password: newPw })
      snack('Password reset')
      setPwMsg(`✓ Done — share this with ${user.full_name}: ${newPw}`)
    } catch (e) { setPwMsg(e.response?.data?.detail || 'Could not reset password.') }
    finally { setPwLoading(false) }
  }

  const save = async () => {
    setLoading(true); setError('')
    try { await api.patch(`/users/${user.id}`, { role, is_active: active }); snack('User updated'); onSaved() }
    catch (e) { setError(e.response?.data?.detail || 'Failed to update.') }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={!!user} onClose={onClose} title={`Edit: ${user.full_name}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div className="m-avatar">{(user.full_name || '?')[0]?.toUpperCase()}</div>
        <div><div style={{ fontWeight: 600 }}>{user.full_name}</div><div className="m-muted" style={{ fontSize: '0.82rem' }}>{user.email}</div></div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label className="m-label">Role</label>
          <select className="m-input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select></div>
        <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span style={{ fontWeight: 500 }}>Account is active</span>
        </label>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={save}>Save changes</Btn>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
          <label className="m-label">Reset password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="m-input" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="New password" style={{ flex: 1, minWidth: 0 }} />
            <Btn type="button" onClick={() => setNewPw(randomPassword(12))}>Generate</Btn>
          </div>
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6 }}>
            At least 8 characters. Share it with them — they can change it themselves from Settings.
          </div>
          {pwMsg && <p className={pwMsg.startsWith('✓') ? 'm-muted' : 'm-error'}
            style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{pwMsg}</p>}
          <Btn full loading={pwLoading} onClick={resetPw} style={{ marginTop: 8 }}>Set new password</Btn>
        </div>
      </div>
    </SheetV3>
  )
}
