import React, { useEffect, useState, useCallback } from 'react'
import { Plus, MapPin, Users as UsersIcon } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, LoadError, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'
import { APPROVALS_ENABLED } from './features'
import { errText } from '../mobile/lib'

// Must match the backend ResourceType enum.
const TYPES = [
  ['classroom', 'Classroom'],
  ['computer_room', 'Computer room'],
  ['lab', 'Lab'],
  ['seminar_hall', 'Seminar hall'],
  ['meeting_room', 'Meeting room'],
  ['equipment', 'Equipment'],
  ['other', 'Other'],
]
const typeLabel = (t) => (TYPES.find(x => x[0] === t) || [null, t])[1]

export function ResourcesV3() {
  const snack = useSnack()
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  // active_only=false so admins can see and revive deactivated rooms too
  const load = useCallback(() => {
    setFailed(false)
    api.get('/resources', { params: { active_only: false } })
      .then(r => setItems(r.data)).catch(() => { setItems([]); setFailed(true) })
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <Btn variant="primary" full onClick={() => { haptic(); setAdding(true) }} style={{ marginBottom: 12 }}>
        <Plus size={18} /> Add room
      </Btn>

      <div className="m-muted" style={{ fontSize: '0.78rem', margin: '0 2px 10px' }}>
        Rooms added here are bookable straight away. Deactivate rather than delete to
        keep a room’s booking history.
      </div>

      {items === null ? <ListSkeleton h={76} /> :
        failed ? <LoadError what="the room list" onRetry={load} /> :
        items.length === 0 ? <Empty icon="🚪" text="No rooms yet." /> :
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
            {items.map(r => (
              <button key={r.id} className="m-card m-eventrow" style={{ textAlign: 'left', opacity: r.is_active ? 1 : 0.55 }}
                onClick={() => { haptic(); setEditing(r) }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="m-muted" style={{ fontSize: '0.8rem' }}>
                    {typeLabel(r.resource_type)}
                    {r.location ? <> · <MapPin size={11} style={{ verticalAlign: '-1px' }} /> {r.location}</> : null}
                    {r.capacity ? <> · <UsersIcon size={11} style={{ verticalAlign: '-1px' }} /> {r.capacity}</> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {r.requires_approval && <span className="m-badge">needs approval</span>}
                  {!r.is_active && <span className="m-badge" style={{ color: 'var(--danger)' }}>inactive</span>}
                </div>
              </button>
            ))}
          </div>}

      <AddRoomSheet open={adding} onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); load() }} snack={snack} />
      <EditRoomSheet room={editing} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load() }} snack={snack} />
    </div>
  )
}

function AddRoomSheet({ open, onClose, onDone, snack }) {
  const [f, setF] = useState({ name: '', resource_type: 'classroom', location: '', capacity: '', requires_approval: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) { setF({ name: '', resource_type: 'classroom', location: '', capacity: '', requires_approval: false }); setError('') }
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!f.name.trim()) { setError('Give the room a name.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/resources', {
        name: f.name.trim(),
        resource_type: f.resource_type,
        location: f.location.trim() || null,
        capacity: f.capacity ? Number(f.capacity) : null,
        requires_approval: f.requires_approval,
      })
      snack('Room added'); onDone()
    } catch (err) { setError(errText(err, 'Could not add the room.')) }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title="Add room">
      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div><label className="m-label">Name</label>
          <input className="m-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="601H-N" /></div>
        <div><label className="m-label">Type</label>
          <select className="m-input" value={f.resource_type} onChange={e => setF({ ...f, resource_type: e.target.value })}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></div>
        <div><label className="m-label">Location</label>
          <input className="m-input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Optional" /></div>
        <div><label className="m-label">Capacity</label>
          <input className="m-input" type="number" min="1" value={f.capacity}
            onChange={e => setF({ ...f, capacity: e.target.value })} placeholder="Optional" /></div>
        {/* Hidden while approvals are off — see features.js. Ticking this is what
            CREATES pending bookings, and with Approve/Reject gone from the Bookings
            page there would be nothing able to resolve them. The value is still sent
            (false for a new room), so the column keeps its meaning for when the flow
            comes back. */}
        {APPROVALS_ENABLED && (
          <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={f.requires_approval}
              onChange={e => setF({ ...f, requires_approval: e.target.checked })} />
            <span style={{ fontWeight: 500 }}>Bookings need admin approval</span>
          </label>
        )}
        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>Add room</Btn>
      </form>
    </SheetV3>
  )
}

function EditRoomSheet({ room, onClose, onDone, snack }) {
  const [f, setF] = useState({ name: '', location: '', capacity: '', requires_approval: false, is_active: true })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (room) {
      setF({
        name: room.name || '', location: room.location || '',
        capacity: room.capacity ?? '', requires_approval: !!room.requires_approval,
        is_active: !!room.is_active,
      })
      setError('')
    }
  }, [room])
  if (!room) return null

  const save = async () => {
    setLoading(true); setError('')
    try {
      await api.patch(`/resources/${room.id}`, {
        name: f.name.trim(),
        location: f.location.trim() || null,
        capacity: f.capacity ? Number(f.capacity) : null,
        requires_approval: f.requires_approval,
        is_active: f.is_active,
      })
      snack('Room updated'); onDone()
    } catch (e) { setError(errText(e, 'Could not update.')) }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={!!room} onClose={onClose} title={`Edit: ${room.name}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div className="m-muted" style={{ fontSize: '0.8rem' }}>Type: {typeLabel(room.resource_type)}</div>
        <div><label className="m-label">Name</label>
          <input className="m-input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="m-label">Location</label>
          <input className="m-input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Optional" /></div>
        <div><label className="m-label">Capacity</label>
          <input className="m-input" type="number" min="1" value={f.capacity}
            onChange={e => setF({ ...f, capacity: e.target.value })} placeholder="Optional" /></div>
        {/* Hidden while approvals are off — see features.js. Note this form SEEDS
            f.requires_approval from the room and sends it back unchanged, so editing a
            room that already carries the flag does not silently clear it. */}
        {APPROVALS_ENABLED && (
          <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={f.requires_approval}
              onChange={e => setF({ ...f, requires_approval: e.target.checked })} />
            <span style={{ fontWeight: 500 }}>Bookings need admin approval</span>
          </label>
        )}
        <label className="m-listbtn" style={{ justifyContent: 'flex-start', gap: 10 }}>
          <input type="checkbox" checked={f.is_active}
            onChange={e => setF({ ...f, is_active: e.target.checked })} />
          <span style={{ fontWeight: 500 }}>Room is active (bookable)</span>
        </label>
        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} onClick={save}>Save changes</Btn>
      </div>
    </SheetV3>
  )
}
