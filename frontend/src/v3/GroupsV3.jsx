import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Users, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'

export function GroupsV3() {
  const snack = useSnack()
  const [groups, setGroups] = useState(null)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(null)

  const load = useCallback(() => { api.get('/groups').then(r => setGroups(r.data)).catch(() => setGroups([])) }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <Btn variant="primary" full onClick={() => setCreating(true)} style={{ marginBottom: 12 }}><Plus size={18} /> New group</Btn>

      {groups === null ? <ListSkeleton h={84} /> :
        groups.length === 0 ? <Empty icon="👥" text="No groups yet. Create one, then add people." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {groups.map(g => (
              <button key={g.id} className="m-card m-eventrow" style={{ textAlign: 'left' }} onClick={() => { haptic(); setManaging(g) }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{g.name}</div>
                  {g.description && <div className="m-muted" style={{ fontSize: '0.8rem' }}>{g.description}</div>}
                  <div className="m-muted" style={{ fontSize: '0.8rem', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Users size={12} /> {g.member_count} {g.member_count === 1 ? 'person' : 'people'}
                  </div>
                </div>
                {g.group_type && <span className="m-badge">{g.group_type}</span>}
              </button>
            ))}
          </div>}

      <CreateGroupSheet open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} snack={snack} />
      <ManageGroupSheet group={managing} onClose={() => setManaging(null)} onChanged={load} snack={snack} />
    </div>
  )
}

function CreateGroupSheet({ open, onClose, onSaved, snack }) {
  const [form, setForm] = useState({ name: '', description: '', group_type: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setForm({ name: '', description: '', group_type: '' }); setError('') } }, [open])

  const submit = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setLoading(true); setError('')
    try { await api.post('/groups', form); snack('Group created'); onSaved() }
    catch (e) { setError(e.response?.data?.detail || 'Failed to create group.') }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="New group">
      <div style={{ display: 'grid', gap: 12 }}>
        <div><label className="m-label">Name</label>
          <input className="m-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. MDes 1st year" /></div>
        <div><label className="m-label">Type (optional)</label>
          <input className="m-input" value={form.group_type} onChange={e => setForm(f => ({ ...f, group_type: e.target.value }))} placeholder="cohort / faculty / staff" /></div>
        <div><label className="m-label">Description (optional)</label>
          <input className="m-input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={submit}>Create</Btn>
      </div>
    </SheetV3>
  )
}

function ManageGroupSheet({ group, onClose, onChanged, snack }) {
  const [detail, setDetail] = useState(null)
  const [roster, setRoster] = useState([])
  const [sel, setSel] = useState('')
  const [np, setNp] = useState({ full_name: '', email: '' })

  const load = useCallback(() => {
    if (!group) return
    api.get(`/groups/${group.id}`).then(r => setDetail(r.data)).catch(() => {})
    api.get('/roster').then(r => setRoster(r.data)).catch(() => {})
  }, [group])
  useEffect(() => { load() }, [load])
  if (!group) return null

  const memberIds = new Set((detail?.members || []).map(m => m.id))
  const available = roster.filter(p => !memberIds.has(p.id))

  const add = async () => { if (!sel) return; await api.post(`/groups/${group.id}/members/${sel}`); setSel(''); snack('Added'); load(); onChanged && onChanged() }
  const remove = async (pid) => { await api.delete(`/groups/${group.id}/members/${pid}`); load(); onChanged && onChanged() }
  const createPerson = async () => {
    if (!np.full_name.trim()) return
    const r = await api.post('/roster', np)
    await api.post(`/groups/${group.id}/members/${r.data.id}`)
    setNp({ full_name: '', email: '' }); snack('Person added'); load(); onChanged && onChanged()
  }

  return (
    <SheetV3 open={!!group} onClose={onClose} title={`Manage: ${group.name}`}>
      <p className="m-section-title" style={{ marginTop: 0 }}>Members ({detail?.members?.length || 0})</p>
      {(detail?.members || []).length === 0 && <p className="m-muted" style={{ fontSize: '0.85rem' }}>No members yet.</p>}
      <div style={{ display: 'grid', gap: 6 }}>
        {(detail?.members || []).map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '0.9rem' }}>{m.full_name}{m.email && <span className="m-muted"> · {m.email}</span>}</span>
            <button className="v-iconbtn" style={{ width: 34, height: 34, color: 'var(--danger)' }} onClick={() => remove(m.id)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <p className="m-section-title">Add existing person</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="m-input" value={sel} onChange={e => setSel(e.target.value)} style={{ flex: 1 }}>
          <option value="">Select a person…</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <Btn onClick={add}>Add</Btn>
      </div>

      <p className="m-section-title">Create new person</p>
      <div style={{ display: 'grid', gap: 8 }}>
        <input className="m-input" value={np.full_name} onChange={e => setNp(p => ({ ...p, full_name: e.target.value }))} placeholder="Full name" />
        <input className="m-input" value={np.email} onChange={e => setNp(p => ({ ...p, email: e.target.value }))} placeholder="Email (optional)" />
        <Btn variant="primary" full onClick={createPerson}>Add to group</Btn>
      </div>
    </SheetV3>
  )
}
