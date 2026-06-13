import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'

const ROLES = ['admin', 'professor', 'staff', 'viewer']

export function UsersV3() {
  const snack = useSnack()
  const [users, setUsers] = useState(null)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => { api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([])) }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
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
    </div>
  )
}

function EditUserSheet({ user, onClose, onSaved, snack }) {
  const [role, setRole] = useState('viewer')
  const [active, setActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (user) { setRole(user.role); setActive(user.is_active); setError('') } }, [user])
  if (!user) return null

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
      </div>
    </SheetV3>
  )
}
