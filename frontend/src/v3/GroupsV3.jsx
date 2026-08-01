import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Users, Trash2 } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { ListSkeleton, Empty, LoadError, Btn, Skeleton, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'
import { useConfirm } from './ConfirmSheet'
import { errText } from '../mobile/lib'

export function GroupsV3() {
  const snack = useSnack()
  const { user } = useAuthStore()
  // Groups are shared reference data (like rooms and event kinds), so only admins
  // manage them. The API enforces this too — hiding the UI is just courtesy, not
  // the security boundary.
  const isAdmin = user?.role === 'admin'
  const [groups, setGroups] = useState(null)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(null)

  const load = useCallback(() => {
    setFailed(false)
    api.get('/groups').then(r => setGroups(r.data)).catch(() => { setGroups([]); setFailed(true) })
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      {isAdmin ? (
        <Btn variant="primary" full onClick={() => setCreating(true)} style={{ marginBottom: 12 }}><Plus size={18} /> New group</Btn>
      ) : (
        <div className="m-muted" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
          Groups are managed by an admin. You can see them here and tag events with them.
        </div>
      )}

      {groups === null ? <ListSkeleton h={84} /> :
        failed ? <LoadError what="the group list" onRetry={load} /> :
        groups.length === 0 ? <Empty icon="👥" text="No groups yet." /> :
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
            {groups.map(g => (
              <button key={g.id} className="m-card m-eventrow"
                style={{ textAlign: 'left', cursor: isAdmin ? 'pointer' : 'default' }}
                onClick={() => { if (!isAdmin) return; haptic(); setManaging(g) }}>
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
    catch (e) { setError(errText(e, 'Failed to create group.')) }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="New group">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
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
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState(false)
  const [confirm, confirmEl] = useConfirm()

  // Reset EVERYTHING when the sheet switches group. Without this the sheet kept
  // the previous group's members, its still-selected person in the dropdown, and
  // a half-typed new name — so "Add" could file someone into the wrong group.
  useEffect(() => {
    setDetail(null); setRoster([]); setSel(''); setNp({ full_name: '', email: '' })
    setBusy(false); setLoadErr(false)
  }, [group?.id])

  const load = useCallback(() => {
    if (!group) return
    setLoadErr(false)
    api.get(`/groups/${group.id}`).then(r => setDetail(r.data)).catch(() => setLoadErr(true))
    api.get('/roster').then(r => setRoster(r.data)).catch(() => setLoadErr(true))
  }, [group])
  useEffect(() => { load() }, [load])
  if (!group) return null

  const memberIds = new Set((detail?.members || []).map(m => m.id))
  const available = roster.filter(p => !memberIds.has(p.id))

  const add = async () => {
    if (!sel || busy) return
    setBusy(true)
    try { await api.post(`/groups/${group.id}/members/${sel}`); setSel(''); snack('Added'); load(); onChanged && onChanged() }
    catch (e) { snack(errText(e, 'Could not add that person')) }
    finally { setBusy(false) }
  }

  const remove = async (m) => {
    if (busy) return
    const ok = await confirm({
      title: `Remove ${m.full_name}?`,
      body: 'Removes them from tagged events.',
      confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true,
    })
    if (!ok) return
    setBusy(true)
    try { await api.delete(`/groups/${group.id}/members/${m.id}`); snack('Removed'); load(); onChanged && onChanged() }
    catch (e) { snack(errText(e, 'Could not remove that person')) }
    finally { setBusy(false) }
  }

  // Delete the whole group. The DELETE /groups/{id} endpoint already existed but no
  // control ever called it, so a mis-created group was permanent. Warn clearly that
  // it untags the group from any events (people stay in the roster).
  const deleteGroup = async () => {
    if (busy) return
    const ok = await confirm({
      title: `Delete “${group.name}”?`,
      body: 'Untags it from events. People stay.',
      confirmLabel: 'Delete group', cancelLabel: 'Keep', danger: true,
    })
    if (!ok) return
    setBusy(true)
    try { await api.delete(`/groups/${group.id}`); snack('Group deleted'); onChanged && onChanged(); onClose() }
    catch (e) { snack(errText(e, 'Could not delete the group')) }
    finally { setBusy(false) }
  }

  // Creates a NEW roster person — the backend does no duplicate check, so an
  // unguarded double tap used to produce two identical people in the group with
  // no way to delete either.
  const createPerson = async () => {
    if (!np.full_name.trim() || busy) return
    setBusy(true)
    try {
      const r = await api.post('/roster', np)
      await api.post(`/groups/${group.id}/members/${r.data.id}`)
      setNp({ full_name: '', email: '' }); snack('Person added'); load(); onChanged && onChanged()
    } catch (e) { snack(errText(e, 'Could not add that person')) }
    finally { setBusy(false) }
  }

  return (
    <SheetV3 open={!!group} onClose={onClose} title={`Manage: ${group.name}`}>
      <p className="m-section-title" style={{ marginTop: 0 }}>
        Members {detail ? `(${detail.members?.length || 0})` : ''}
      </p>
      {loadErr
        ? <p className="m-error" style={{ fontSize: '0.85rem' }}>
            Couldn’t load this group. <button className="m-link" onClick={load}>Retry</button>
          </p>
        /* `detail === null` means still loading — showing "No members yet" then
           would claim the group is empty before we know anything about it */
        : detail === null ? <Skeleton h={54} />
        : detail.members?.length === 0 ? <p className="m-muted" style={{ fontSize: '0.85rem' }}>No members yet.</p>
        : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6 }}>
        {(detail?.members || []).map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            <span style={{ fontSize: '0.9rem', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {m.full_name}{m.email && <span className="m-muted"> · {m.email}</span>}
            </span>
            <button className="v-iconbtn" style={{ flex: '0 0 auto', color: 'var(--danger)' }}
              disabled={busy} aria-label={`Remove ${m.full_name}`} onClick={() => remove(m)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>

      <p className="m-section-title">Add existing person</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="m-input" value={sel} onChange={e => setSel(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
          <option value="">Select a person…</option>
          {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
        <Btn onClick={add} disabled={!sel || busy}>Add</Btn>
      </div>

      <p className="m-section-title">Create new person</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
        <input className="m-input" value={np.full_name} onChange={e => setNp(p => ({ ...p, full_name: e.target.value }))} placeholder="Full name" />
        <input className="m-input" value={np.email} onChange={e => setNp(p => ({ ...p, email: e.target.value }))} placeholder="Email (optional)" />
        <Btn variant="primary" full loading={busy} disabled={!np.full_name.trim()} onClick={createPerson}>Add to group</Btn>
      </div>

      {/* Danger zone — delete the whole group. Separated from the member controls so
          it isn't tapped by accident. */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <button className="m-link" style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          disabled={busy} onClick={deleteGroup}>
          <Trash2 size={15} /> Delete this group
        </button>
      </div>
      {confirmEl}
    </SheetV3>
  )
}
