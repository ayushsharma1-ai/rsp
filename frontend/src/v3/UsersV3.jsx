import React, { useEffect, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import { useAuthStore } from '../store/authStore'
import SheetV3 from './SheetV3'
import { useConfirm } from './ConfirmSheet'
import { errText } from '../mobile/lib'

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
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
            {users.map(u => (
              <button key={u.id} className="m-card m-eventrow" style={{ textAlign: 'left' }} onClick={() => { haptic(); setEditing(u) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div className="m-avatar" style={{ width: 40, height: 40, fontSize: '0.95rem' }}>{(u.full_name || '?')[0]?.toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name}</div>
                    <div className="m-muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
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
      <AddMemberSheet open={adding} onClose={() => setAdding(false)} onCreated={load} snack={snack} />
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
  // Holds the just-created credentials so we can KEEP the sheet open and show them.
  // Previously the sheet closed on success and the initial password (often generated)
  // was gone for good — the account couldn't be signed into until a separate reset.
  const [created, setCreated] = useState(null)   // { email, password }

  const reset = () => { setUsername(''); setFullName(''); setRole('professor'); setPassword(''); setError(''); setCreated(null) }
  useEffect(() => { if (open) reset() }, [open])

  const genPassword = () => setPassword(randomPassword(12))

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim()) { setError('Enter a username.'); return }
    if (!fullName.trim()) { setError('Enter the full name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true); setError('')
    try {
      const email = `${username.trim().toLowerCase()}@${DOMAIN}`
      await api.post('/users', { email, full_name: fullName.trim(), role, password })
      snack('Member added')
      setCreated({ email, password })   // keep the sheet open, echo the credentials
      onCreated()                       // refresh the list in the background
    } catch (err) { setError(errText(err, 'Could not add member.')) }
    finally { setLoading(false) }
  }

  if (created) {
    return (
      <SheetV3 open={open} onClose={onClose} title="Member added">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
          <div className="m-card" style={{ background: 'var(--surface-2)' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>✓ {fullName.trim()} can now sign in</div>
            <p className="m-muted" style={{ fontSize: '0.82rem', margin: '0 0 10px', lineHeight: 1.5 }}>
              Shown once. Copy it now.
            </p>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.9 }}>
              <div><span className="m-muted">Email:&nbsp;</span><strong style={{ userSelect: 'all', wordBreak: 'break-all' }}>{created.email}</strong></div>
              <div><span className="m-muted">Password:&nbsp;</span><strong style={{ userSelect: 'all' }}>{created.password}</strong></div>
            </div>
          </div>
          <Btn variant="primary" full onClick={onClose}>Done</Btn>
          <Btn full onClick={reset}>Add another</Btn>
        </div>
      </SheetV3>
    )
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Add member">
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div>
          <label className="m-label">Email</label>
          <div className="m-input" style={{ display: 'flex', alignItems: 'center', padding: '0 12px 0 14px', gap: 2 }}>
            {/* No placeholder. Worse here than on the login screen: this is where an
                admin CREATES an account, so a wrong format hint produced accounts
                that don't match the institute's actual usernames (stroy, vkant). */}
            <input value={username} onChange={e => setUsername(e.target.value)}
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
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6 }}>Share with the member.</div>
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
  const [confirm, confirmEl] = useConfirm()
  const { user: me } = useAuthStore()
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
      setPwMsg(`✓ New password: ${newPw}`)
    } catch (e) { setPwMsg(errText(e, 'Could not reset password.')) }
    finally { setPwLoading(false) }
  }

  // Editing YOUR OWN row can lock you out of the app entirely: deactivating makes
  // every request 401 (which force-logs-you-out), and dropping your own admin role
  // hides the Users screen you'd need to undo it. Either way recovery needs another
  // admin or database access — so say so plainly before it happens.
  // the auth store keeps the LOGIN RESPONSE, whose key is `user_id` (not `id`), so
  // `me?.id` was always undefined and the self-lockout confirmation never appeared
  const myId = me?.user_id || me?.id
  const editingSelf = !!myId && myId === user.id
  const losingAdmin = editingSelf && me?.role === 'admin' && role !== 'admin'
  const lockingSelfOut = editingSelf && !active

  const save = async () => {
    if (lockingSelfOut || losingAdmin) {
      const ok = await confirm({
        title: lockingSelfOut ? 'Deactivate your own account?' : 'Give up your own admin access?',
        body: lockingSelfOut
          ? 'Signs you out. Only an admin can undo.'
          : 'Removes your admin access.',
        confirmLabel: lockingSelfOut ? 'Deactivate my account' : 'Give up admin', cancelLabel: 'Go back', danger: true,
      })
      if (!ok) return
    }
    setLoading(true); setError('')
    try { await api.patch(`/users/${user.id}`, { role, is_active: active }); snack('User updated'); onSaved() }
    catch (e) { setError(errText(e, 'Couldn’t save. Retry.')) }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={!!user} onClose={onClose} title={`Edit: ${user.full_name}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div className="m-avatar">{(user.full_name || '?')[0]?.toUpperCase()}</div>
        <div><div style={{ fontWeight: 600 }}>{user.full_name}</div><div className="m-muted" style={{ fontSize: '0.82rem' }}>{user.email}</div></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div><label className="m-label">Role</label>
          <select className="m-input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
          </select></div>
        <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          <span style={{ fontWeight: 500 }}>Account is active</span>
        </label>
        {(lockingSelfOut || losingAdmin) && (
          <div className="m-warn" style={{ fontSize: '0.82rem' }}>
            {lockingSelfOut ? 'Saving signs you out.' : 'Removes your admin access.'}
            {/* The four admin-only screens as chips. As a sentence this was a
                24-word paragraph listing them inline. */}
            {losingAdmin && (
              <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible', marginTop: 8 }}>
                {['Users', 'Groups', 'Rooms', 'Kinds'].map(x => (
                  <span key={x} className="m-chip" style={{ pointerEvents: 'none' }}>{x}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={save}>Save</Btn>
        {confirmEl}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
          <label className="m-label">Reset password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="m-input" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="New password" style={{ flex: 1, minWidth: 0 }} />
            <Btn type="button" onClick={() => setNewPw(randomPassword(12))}>Generate</Btn>
          </div>
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6 }}>
            Min 8 characters.
          </div>
          {pwMsg && <p className={pwMsg.startsWith('✓') ? 'm-muted' : 'm-error'}
            style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{pwMsg}</p>}
          <Btn full loading={pwLoading} onClick={resetPw} style={{ marginTop: 8 }}>Set new password</Btn>
        </div>
      </div>
    </SheetV3>
  )
}
