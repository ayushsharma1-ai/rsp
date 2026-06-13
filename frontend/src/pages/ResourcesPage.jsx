import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PageHeader, Card, Badge, Btn, Modal, Field, Spinner, Empty } from '../components/ui'
import { Plus, MapPin, Users, Edit2 } from 'lucide-react'

const TYPES = ['classroom', 'lab', 'computer_room', 'seminar_hall', 'meeting_room', 'equipment', 'other']
const TYPE_LABEL = { classroom: 'Classroom', lab: 'Lab', computer_room: 'Computer Room', seminar_hall: 'Seminar Hall', meeting_room: 'Meeting Room', equipment: 'Equipment', other: 'Other' }

function roomLabel(r) {
  const type = TYPE_LABEL[r.resource_type] || r.resource_type   // (1)(2)(3)
  const lastWord = type.split(' ').pop().toLowerCase()          // (4)
  let name = (r.name || '').trim()                              // (5)
  if (name.toLowerCase().includes(lastWord)) return name        // (6)
  name = name.replace(/^room\s+/i, '')                          // (7)
  return `${type} ${name}`                                      // (8)
}

export default function ResourcesPage() {
  const { user } = useAuthStore()
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)
  const [slotsFor, setSlotsFor] = useState(null)
  const [filter, setFilter] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))   // "2026-06-08"
  const [availability, setAvailability] = useState({})                       // { roomId: {is_free, busy} }
  const [search, setSearch] = useState('')                                    // text typed in the search box
  const [onlyFree, setOnlyFree] = useState(false)                            // show only rooms free on `date`
  const isAdmin = user?.role === 'admin'

  const fetchResources = useCallback(() => {
    setLoading(true)
    const params = filter ? { resource_type: filter } : {}
    api.get('/resources', { params })
      .then(r => setResources(r.data))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { fetchResources() }, [fetchResources])
  useEffect(() => {
    api.get('/availability/day', { params: { date } })   // GET /api/v1/availability/day?date=2026-06-08
      .then(r => {
        const map = {}
        for (const item of r.data) {     // r.data is the array your endpoint returns
          map[item.id] = item            // build a lookup: id -> that room's availability
        }
        setAvailability(map)             // store it → triggers re-render
      })
  }, [date])   // ← dependency array: "re-run this whenever `date` changes"
  const filtered = resources.filter(r => {
    if (filter && r.resource_type !== filter) return false                       // type pill
    if (onlyFree && !availability[r.id]?.is_free) return false                   // "only free" toggle
    if (search && !roomLabel(r).toLowerCase().includes(search.toLowerCase())) return false  // text search
    return true
  })

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Classrooms, labs, equipment and more"
        action={isAdmin && (
          <Btn onClick={() => setShowCreate(true)}><Plus size={16} /> Add Resource</Btn>
        )}
      />
    <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>
        Availability on:{' '}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <input
        type="text"
        placeholder="Search rooms…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '0.4rem 0.6rem' }}
      />
      <label style={{ fontSize: '0.85rem', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} style={{ width: 'auto' }} />
        Only free rooms
      </label>
    </div>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {TYPES.map(t => (
          <button key={t} className={`filter-btn ${filter === t ? 'filter-btn--active' : ''}`} onClick={() => setFilter(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
        <button className={`filter-btn ${!filter ? 'filter-btn--active' : ''}`} onClick={() => setFilter('')}>All</button>
      </div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : filtered.length === 0 ? (
        <Empty icon="🏛️" title="No resources found" subtitle="Add resources as an admin to get started." />
      ) : (
        TYPES.map(t => {
          const group = filtered.filter(r => r.resource_type === t)
          if (group.length === 0) return null
          return (
            <section key={t} style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text2)', margin: '0 0 0.75rem' }}>
                {TYPE_LABEL[t]} <span style={{ fontWeight: 500, opacity: 0.6 }}>({group.length})</span>
              </h2>
              <div className="resource-grid">
                {group.map(r => (
                  <ResourceCard key={r.id} r={r} isAdmin={isAdmin} onEdit={setEditing} availability={availability[r.id]} onFindSlots={setSlotsFor} />
                ))}
              </div>
            </section>
          )
        })
      )}

      <ResourceModal
        open={showCreate || !!editing}
        onClose={() => { setShowCreate(false); setEditing(null) }}
        initial={editing}
        onSaved={() => { setShowCreate(false); setEditing(null); fetchResources() }}
      />
      <FreeSlotsModal resource={slotsFor} date={date} onClose={() => setSlotsFor(null)} />
    </div>
  )
}

function ResourceCard({ r, isAdmin, onEdit, availability, onFindSlots }) {
  return (
    <Card className="resource-card">
      <div className="resource-card__header">
        <div>
          {/* <h3 className="resource-card__name">{r.name}</h3> */}
                    <h3 className="resource-card__name">
            {availability && (
              <span
                title={availability.is_free ? 'Free' : 'Busy'}
                style={{ color: availability.is_free ? '#16a34a' : '#ea580c', marginRight: '0.4rem' }}
              >●</span>
            )}
            {roomLabel(r)}
          </h3>
          {/* <Badge label={TYPE_LABEL[r.resource_type] || r.resource_type} type={r.resource_type} /> */}
        </div>
        {isAdmin && (
          <button className="resource-edit-btn" onClick={() => onEdit(r)} title="Edit">
            <Edit2 size={14} />
          </button>
        )}
      </div>
      {r.description && <p className="resource-card__desc">{r.description}</p>}
      <div className="resource-card__meta">
        {r.location && (
          <span><MapPin size={12} /> {r.location}</span>
        )}
        {r.capacity && (
          <span><Users size={12} /> {r.capacity} seats</span>
        )}
      </div>
      <div className="resource-card__footer">
        <span className={`approval-tag ${r.requires_approval ? 'approval-tag--manual' : 'approval-tag--auto'}`}>
          {r.requires_approval ? '⚠ Requires Approval' : '✓ Auto-confirm'}
        </span>
        <Badge label={r.is_active ? 'Active' : 'Inactive'} type={r.is_active ? 'active' : 'inactive'} />
      </div>
      <div style={{ marginTop: '0.5rem' }}>
        <Btn variant="ghost" onClick={() => onFindSlots(r)}>Find open times</Btn>
      </div>
    </Card>
  )
}

function FreeSlotsModal({ resource, date, onClose }) {
  const [duration, setDuration] = useState(60)
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(false)
  const open = !!resource

  useEffect(() => {
    if (!resource) return
    setLoading(true)
    api.get('/availability/free-slots', { params: { resource_id: resource.id, date, duration_minutes: duration } })
      .then(r => setSlots(r.data.free_slots))
      .catch(() => setSlots([]))
      .finally(() => setLoading(false))
  }, [resource, date, duration])

  if (!open) return null

  const hhmm = (s) => { try { return new Date(s).toISOString().slice(11, 16) } catch { return s } }

  return (
    <Modal open={open} onClose={onClose} title={`Open times · ${roomLabel(resource)}`}>
      <p style={{ fontSize: '0.85rem', opacity: 0.7, margin: '0 0 0.75rem' }}>
        Searching {date} (working hours 08:00–20:00 UTC)
      </p>
      <Field label="Minimum length (minutes)">
        <input type="number" min={15} step={15} value={duration}
               onChange={e => setDuration(Number(e.target.value) || 60)} />
      </Field>
      {loading ? (
        <Spinner size={20} />
      ) : slots.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No open windows of that length on this date.</p>
      ) : (
        <ul style={{ paddingLeft: '1.2rem' }}>
          {slots.map((s, i) => <li key={i}>{hhmm(s.start)} – {hhmm(s.end)}</li>)}
        </ul>
      )}
    </Modal>
  )
}

function ResourceModal({ open, onClose, initial, onSaved }) {
  const [form, setForm] = useState({
    name: '', description: '', resource_type: 'classroom',
    location: '', capacity: '', requires_approval: false,
    ...(initial || {}),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm({ name: '', description: '', resource_type: 'classroom', location: '', capacity: '', requires_approval: false, ...(initial || {}) })
    setError('')
  }, [initial, open])

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(f => ({ ...f, [k]: v }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const payload = { ...form, capacity: form.capacity ? Number(form.capacity) : null }
      if (initial) {
        await api.patch(`/resources/${initial.id}`, payload)
      } else {
        await api.post('/resources', payload)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save resource')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit Resource' : 'Add Resource'}>
      <form onSubmit={submit} className="form-grid">
        <Field label="Name">
          <input value={form.name} onChange={set('name')} placeholder="e.g. Room A101" required />
        </Field>
        <Field label="Type">
          <select value={form.resource_type} onChange={set('resource_type')}>
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea value={form.description} onChange={set('description')} rows={2} placeholder="Optional description" />
        </Field>
        <div className="form-grid form-grid--2">
          <Field label="Location">
            <input value={form.location} onChange={set('location')} placeholder="Building A, Floor 2" />
          </Field>
          <Field label="Capacity">
            <input type="number" value={form.capacity} onChange={set('capacity')} placeholder="e.g. 30" min={1} />
          </Field>
        </div>
        <Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--text2)' }}>
            <input type="checkbox" checked={form.requires_approval} onChange={set('requires_approval')} style={{ width: 'auto' }} />
            Requires admin approval to book
          </label>
        </Field>
        {error && <p style={{ color: 'var(--red)', fontSize: '0.85rem' }}>{error}</p>}
        <div className="form-actions">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" loading={loading}>{initial ? 'Save Changes' : 'Add Resource'}</Btn>
        </div>
      </form>
    </Modal>
  )
}
