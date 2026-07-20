import React, { useEffect, useState, useCallback } from 'react'
import { Plus } from 'lucide-react'
import api from '../lib/api'
import { ListSkeleton, Empty, Btn, useSnack } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'
import { EVENT_COLORS, readableOn } from './config'

// Event kinds are the categories shown when creating an event (Class, Workshop,
// Talk...). The kind's colour is what the calendar paints the event with.
export function KindsV3() {
  const snack = useSnack()
  const [kinds, setKinds] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    api.get('/event-kinds').then(r => setKinds(r.data)).catch(() => setKinds([]))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <Btn variant="primary" full onClick={() => { haptic(); setAdding(true) }} style={{ marginBottom: 12 }}>
        <Plus size={18} /> Add event kind
      </Btn>

      <div className="m-muted" style={{ fontSize: '0.78rem', margin: '0 2px 10px' }}>
        These are the categories people pick when creating an event. The colour here is
        the colour the event shows on the calendar.
      </div>

      {kinds === null ? <ListSkeleton h={64} /> :
        kinds.length === 0 ? <Empty icon="🏷️" text="No event kinds yet." /> :
          <div style={{ display: 'grid', gap: 10 }}>
            {kinds.map(k => (
              <button key={k.id} className="m-card m-eventrow" style={{ textAlign: 'left' }}
                onClick={() => { haptic(); setEditing(k) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{
                    width: 34, height: 34, borderRadius: 10, background: k.color,
                    color: readableOn(k.color), display: 'grid', placeItems: 'center',
                    fontWeight: 700, fontSize: '0.85rem', flex: '0 0 auto',
                  }}>{(k.name || '?')[0].toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{k.name}</div>
                    <div className="m-muted" style={{ fontSize: '0.78rem' }}>{k.color}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>}

      <KindSheet open={adding} kind={null} onClose={() => setAdding(false)}
        onDone={() => { setAdding(false); load() }} snack={snack} />
      <KindSheet open={!!editing} kind={editing} onClose={() => setEditing(null)}
        onDone={() => { setEditing(null); load() }} snack={snack} />
    </div>
  )
}

// One sheet for both add and edit — `kind` null means "add".
function KindSheet({ open, kind, onClose, onDone, snack }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(EVENT_COLORS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setName(kind?.name || '')
      setColor(kind?.color || EVENT_COLORS[0])
      setError('')
    }
  }, [open, kind])

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setError('Give the kind a name.'); return }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) { setError('Colour must be a hex value like #d99a4e.'); return }
    setLoading(true); setError('')
    try {
      if (kind) await api.patch(`/event-kinds/${kind.id}`, { name: name.trim(), color })
      else await api.post('/event-kinds', { name: name.trim(), color })
      snack(kind ? 'Kind updated' : 'Kind added'); onDone()
    } catch (err) { setError(err.response?.data?.detail || 'Could not save.') }
    finally { setLoading(false) }
  }

  return (
    <SheetV3 open={open} onClose={onClose} title={kind ? `Edit: ${kind.name}` : 'Add event kind'}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div><label className="m-label">Name</label>
          <input className="m-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Seminar" /></div>

        <div>
          <label className="m-label">Colour</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible', gap: 8 }}>
            {EVENT_COLORS.map(c => (
              <button key={c} type="button" onClick={() => { haptic(); setColor(c) }}
                aria-label={c}
                style={{
                  width: 34, height: 34, borderRadius: 10, background: c, cursor: 'pointer',
                  border: color.toLowerCase() === c.toLowerCase() ? '3px solid var(--text)' : '1px solid var(--border)',
                }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input className="m-input" value={color} onChange={e => setColor(e.target.value)}
              placeholder="#d99a4e" style={{ flex: 1, minWidth: 0 }} />
            <span style={{
              width: 44, height: 44, borderRadius: 10, background: color,
              border: '1px solid var(--border)', flex: '0 0 auto',
            }} />
          </div>
        </div>

        {error && <p className="m-error">{error}</p>}
        <Btn type="submit" variant="primary" full loading={loading}>{kind ? 'Save changes' : 'Add kind'}</Btn>
      </form>
    </SheetV3>
  )
}
