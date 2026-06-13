import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { PageHeader, Card, Badge, Btn, Modal, Field, Spinner, Empty } from '../components/ui'
import { Plus, Users, Trash2, UserPlus } from 'lucide-react'

// Groups & Roster management (Phase 2).
// A "group" is a cohort of people; clash detection expands groups -> people.
export default function GroupsPage() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [managing, setManaging] = useState(null)   // the group currently being managed

  const fetchGroups = useCallback(() => {
    setLoading(true)
    api.get('/groups').then(r => setGroups(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchGroups() }, [fetchGroups])

  return (
    <div>
      <PageHeader
        title="Groups & Roster"
        subtitle="Cohorts of students — used to detect when two events pull the same people"
        action={<Btn onClick={() => setShowCreate(true)}><Plus size={16} /> New Group</Btn>}
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : groups.length === 0 ? (
        <Empty icon="👥" title="No groups yet" subtitle="Create a group, then add people to it." />
      ) : (
        <div className="resource-grid">
          {groups.map(g => (
            <Card key={g.id} className="resource-card">
              <div className="resource-card__header">
                <div>
                  <h3 className="resource-card__name">{g.name}</h3>
                  {g.group_type && <Badge label={g.group_type} />}
                </div>
              </div>
              {g.description && <p className="resource-card__desc">{g.description}</p>}
              <div className="resource-card__meta">
                <span><Users size={12} /> {g.member_count} {g.member_count === 1 ? 'person' : 'people'}</span>
              </div>
              <div className="resource-card__footer">
                <Btn variant="ghost" onClick={() => setManaging(g)}>Manage</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateGroupModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={() => { setShowCreate(false); fetchGroups() }}
      />
      <ManageGroupModal
        group={managing}
        onClose={() => setManaging(null)}
        onChanged={fetchGroups}
      />
    </div>
  )
}

function CreateGroupModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', description: '', group_type: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setForm({ name: '', description: '', group_type: '' }); setError('') }, [open])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.post('/groups', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create group')
    } finally { setLoading(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Group">
      <form onSubmit={submit} className="form-grid">
        <Field label="Name">
          <input value={form.name} onChange={set('name')} placeholder="e.g. First-year CS" required />
        </Field>
        <Field label="Type (optional)">
          <input value={form.group_type} onChange={set('group_type')} placeholder="cohort / section / year" />
        </Field>
        <Field label="Description">
          <textarea value={form.description} onChange={set('description')} rows={2} placeholder="Optional" />
        </Field>
        {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
        <div className="form-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>Create</Btn>
        </div>
      </form>
    </Modal>
  )
}

function ManageGroupModal({ group, onClose, onChanged }) {
  const [detail, setDetail] = useState(null)      // group + its members
  const [roster, setRoster] = useState([])        // all roster people
  const [selPerson, setSelPerson] = useState('')
  const [newPerson, setNewPerson] = useState({ full_name: '', email: '' })

  const open = !!group

  const load = useCallback(() => {
    if (!group) return
    api.get(`/groups/${group.id}`).then(r => setDetail(r.data))
    api.get('/roster').then(r => setRoster(r.data))
  }, [group])

  useEffect(() => { load() }, [load])

  if (!open) return null

  const memberIds = new Set((detail?.members || []).map(m => m.id))
  const available = roster.filter(p => !memberIds.has(p.id))

  const addMember = async () => {
    if (!selPerson) return
    await api.post(`/groups/${group.id}/members/${selPerson}`)
    setSelPerson('')
    load(); onChanged && onChanged()
  }
  const removeMember = async (pid) => {
    await api.delete(`/groups/${group.id}/members/${pid}`)
    load(); onChanged && onChanged()
  }
  const createPerson = async (e) => {
    e.preventDefault()
    if (!newPerson.full_name) return
    const r = await api.post('/roster', newPerson)
    await api.post(`/groups/${group.id}/members/${r.data.id}`)   // add the new person straight into this group
    setNewPerson({ full_name: '', email: '' })
    load(); onChanged && onChanged()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Manage: ${group.name}`}>
      <h4 style={{ margin: '0 0 0.5rem' }}>Members ({detail?.members?.length || 0})</h4>
      {(detail?.members || []).length === 0 && <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>No members yet.</p>}
      {(detail?.members || []).map(m => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.3rem 0' }}>
          <span>{m.full_name}{m.email && <span style={{ opacity: 0.6 }}> · {m.email}</span>}</span>
          <button className="resource-edit-btn" onClick={() => removeMember(m.id)} title="Remove">
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <h4 style={{ margin: '1rem 0 0.5rem' }}>Add existing person</h4>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <select value={selPerson} onChange={e => setSelPerson(e.target.value)} style={{ flex: 1 }}>
          <option value="">Select a person…</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <Btn type="button" onClick={addMember}><UserPlus size={14} /> Add</Btn>
      </div>

      <h4 style={{ margin: '1rem 0 0.5rem' }}>Create new person</h4>
      <form onSubmit={createPerson} style={{ display: 'flex', gap: '0.5rem' }}>
        <input value={newPerson.full_name} onChange={e => setNewPerson(p => ({ ...p, full_name: e.target.value }))} placeholder="Full name" required style={{ flex: 1 }} />
        <input value={newPerson.email} onChange={e => setNewPerson(p => ({ ...p, email: e.target.value }))} placeholder="Email (optional)" style={{ flex: 1 }} />
        <Btn type="submit">Add</Btn>
      </form>
    </Modal>
  )
}
