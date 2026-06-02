import React, { useEffect, useState, useCallback } from 'react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PageHeader, Card, Badge, Btn, Modal, Field, Spinner, Empty } from '../components/ui'
import { Plus, MapPin, Users, Edit2 } from 'lucide-react'

const TYPES = ['classroom', 'lab', 'seminar_hall', 'meeting_room', 'equipment', 'other']
const TYPE_LABEL = { classroom: 'Classroom', lab: 'Lab', seminar_hall: 'Seminar Hall', meeting_room: 'Meeting Room', equipment: 'Equipment', other: 'Other' }

export default function ResourcesPage() {
  const { user } = useAuthStore()
  const [resources, setResources] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filter, setFilter] = useState('')
  const isAdmin = user?.role === 'admin'

  const fetchResources = useCallback(() => {
    setLoading(true)
    const params = filter ? { resource_type: filter } : {}
    api.get('/resources', { params })
      .then(r => setResources(r.data))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { fetchResources() }, [fetchResources])

  const filtered = filter ? resources.filter(r => r.resource_type === filter) : resources

  return (
    <div>
      <PageHeader
        title="Resources"
        subtitle="Classrooms, labs, equipment and more"
        action={isAdmin && (
          <Btn onClick={() => setShowCreate(true)}><Plus size={16} /> Add Resource</Btn>
        )}
      />

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button className={`filter-btn ${!filter ? 'filter-btn--active' : ''}`} onClick={() => setFilter('')}>All</button>
        {TYPES.map(t => (
          <button key={t} className={`filter-btn ${filter === t ? 'filter-btn--active' : ''}`} onClick={() => setFilter(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size={28} /></div>
      ) : filtered.length === 0 ? (
        <Empty icon="🏛️" title="No resources found" subtitle="Add resources as an admin to get started." />
      ) : (
        <div className="resource-grid">
          {filtered.map(r => (
            <Card key={r.id} className="resource-card">
              <div className="resource-card__header">
                <div>
                  <h3 className="resource-card__name">{r.name}</h3>
                  <Badge label={TYPE_LABEL[r.resource_type] || r.resource_type} type={r.resource_type} />
                </div>
                {isAdmin && (
                  <button className="resource-edit-btn" onClick={() => setEditing(r)} title="Edit">
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
            </Card>
          ))}
        </div>
      )}

      <ResourceModal
        open={showCreate || !!editing}
        onClose={() => { setShowCreate(false); setEditing(null) }}
        initial={editing}
        onSaved={() => { setShowCreate(false); setEditing(null); fetchResources() }}
      />
    </div>
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
