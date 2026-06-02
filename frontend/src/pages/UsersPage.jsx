import React, { useEffect, useState } from 'react'
import api from '../lib/api'
import { PageHeader, Table, Badge, Btn, Modal, Field, Spinner } from '../components/ui'
import { Edit2 } from 'lucide-react'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const fetch = () => {
    setLoading(true)
    api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetch() }, [])

  const columns = [
    { key: 'full_name', label: 'Name', render: (v) => <strong style={{ color: 'var(--text)' }}>{v}</strong> },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', render: (v) => <Badge label={v} type={v} /> },
    { key: 'is_active', label: 'Status', render: (v) => <Badge label={v ? 'Active' : 'Inactive'} type={v ? 'active' : 'inactive'} /> },
    {
      key: 'id', label: 'Actions',
      render: (id, row) => (
        <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(row) }}>
          <Edit2 size={13} /> Edit
        </Btn>
      )
    }
  ]

  return (
    <div>
      <PageHeader title="Users" subtitle="Manage platform users and roles" />
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : (
        <Table columns={columns} data={users} />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); fetch() }}
        />
      )}
    </div>
  )
}

function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ role: user.role, is_active: user.is_active })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.patch(`/users/${user.id}`, form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open title={`Edit: ${user.full_name}`} onClose={onClose} width={400}>
      <form onSubmit={submit} className="form-grid">
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div className="sidebar__avatar" style={{ width: 44, height: 44, fontSize: '1rem', flexShrink: 0 }}>
            {user.full_name[0].toUpperCase()}
          </div>
          <div>
            <p style={{ fontWeight: 600, color: 'var(--text)' }}>{user.full_name}</p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>{user.email}</p>
          </div>
        </div>
        <Field label="Role">
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="admin">Admin</option>
            <option value="professor">Professor</option>
            <option value="staff">Staff</option>
            <option value="viewer">Viewer</option>
          </select>
        </Field>
        <Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text2)' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 'auto' }} />
            Account is active
          </label>
        </Field>
        {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
        <div className="form-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Save Changes</Btn>
        </div>
      </form>
    </Modal>
  )
}
