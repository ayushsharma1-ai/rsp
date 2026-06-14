import React, { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import api from '../lib/api'
import { Btn, useSnack } from '../mobile/ui'
import { TIME_SLOTS, toISO } from '../mobile/lib'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'
import { VENUES, GROUPS, EVENT_COLORS, resourceForVenue, groupIdForLabel } from './config'

// Google-Calendar-style create: opened from a tapped/selected slot (date + time
// fixed from the calendar box). Time stays editable here; to change the DATE you
// go back to the calendar. Field order per spec: Title → Venue → Groups.
// Restores the v2 live clash preview: student clash = hard block, venue clash =
// one-tap release request.
export default function CreateEventV3({ open, onClose, onCreated, date, start, end }) {
  const snack = useSnack()
  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('601H-N')
  const [link, setLink] = useState('')
  const [groups, setGroups] = useState([])
  const [color, setColor] = useState(null)         // null = auto (venue color)
  const [startT, setStartT] = useState(start || '09:00')
  const [endT, setEndT] = useState(end || '10:00')
  const [resources, setResources] = useState([])
  const [realGroups, setRealGroups] = useState([])
  const [clashes, setClashes] = useState([])
  const [requested, setRequested] = useState({})
  const [sending, setSending] = useState(null)     // booking_id currently being requested
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const s = start || '09:00'
    const sIdx = TIME_SLOTS.findIndex(x => x.value === s)
    setTitle(''); setVenue('601H-N'); setLink(''); setGroups([]); setColor(null)
    setStartT(s); setEndT(end || TIME_SLOTS[Math.min(sIdx + 2, TIME_SLOTS.length - 1)]?.value || '10:00')
    setError(''); setClashes([]); setRequested({})
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
    api.get('/groups').then(r => setRealGroups(r.data)).catch(() => {})
  }, [open, start, end])

  const venueObj = VENUES.find(v => v.key === venue)
  const isOnline = !!venueObj?.online
  const mappedResource = !isOnline ? resourceForVenue(venueObj, resources) : null
  const groupIds = groups.map(k => groupIdForLabel(GROUPS.find(g => g.key === k).label, realGroups)).filter(Boolean)

  // live clash preview (venue + students)
  useEffect(() => {
    if (!open) return
    if (endT <= startT) { setClashes([]); return }
    const resource_ids = mappedResource ? [mappedResource.id] : []
    if (resource_ids.length === 0 && groupIds.length === 0) { setClashes([]); return }
    const startISO = toISO(date, startT), endISO = toISO(date, endT)
    let cancelled = false
    api.post('/clashes/preview', { start_time: startISO, end_time: endISO, group_ids: groupIds, resource_ids })
      .then(r => { if (!cancelled) setClashes(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, date, startT, endT, venue, groups.join(','), resources.length, realGroups.length])

  const hasStudentClash = clashes.some(c => c.student_clash)
  const allGroupsOn = groups.length === GROUPS.length
  const toggleGroup = (k) => setGroups(g => g.includes(k) ? g.filter(x => x !== k) : [...g, k])
  const toggleAll = () => setGroups(allGroupsOn ? [] : GROUPS.map(g => g.key))

  const sendRequest = async (vb) => {
    if (sending) return
    setSending(vb.booking_id)
    try {
      await api.post('/release-requests', {
        booking_id: vb.booking_id, message: '',
        proposed_event: {
          title: title || 'Requested event', description: isOnline ? `Online meeting: ${link}` : '',
          start_time: toISO(date, startT), end_time: toISO(date, endT),
          resource_id: vb.resource_id, group_ids: groupIds, category: 'adhoc',
        },
      })
      setRequested(p => ({ ...p, [vb.booking_id]: true }))
      // clear, well-formatted confirmation, then close the create sheet
      const tl = (v) => TIME_SLOTS.find(s => s.value === v)?.label || v
      const dayLabel = format(new Date(`${date}T00:00`), 'EEE, MMM d')
      snack(`Request sent to ${vb.holder_name} — ${vb.resource_name}, ${dayLabel} · ${tl(startT)}–${tl(endT)}`)
      onClose && onClose()
    } catch {
      snack('Could not send request — try again.')
    } finally {
      setSending(null)
    }
  }

  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Give the event a title.'); return }
    if (endT <= startT) { setError('End time must be after start time.'); return }
    if (isOnline && !link.trim()) { setError('Add a meeting link for the online event.'); return }
    if (hasStudentClash) { setError('Students here are already booked elsewhere — pick another slot.'); return }
    setLoading(true)
    try {
      const startISO = toISO(date, startT), endISO = toISO(date, endT)
      const bookings = mappedResource ? [{ resource_id: mappedResource.id, start_time: startISO, end_time: endISO, notes: '' }] : []
      const description = isOnline ? `Online meeting: ${link.trim()}` : ''
      await api.post('/events', { title: title.trim(), description, start_time: startISO, end_time: endISO, is_public: true, bookings, group_ids: groupIds, category: 'adhoc', color })
      haptic(12); snack('Event created'); onCreated && onCreated()
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create — that slot may be busy.')
    } finally { setLoading(false) }
  }

  const endSlots = TIME_SLOTS.filter(s => s.value > startT)
  const labelFor = (v) => TIME_SLOTS.find(s => s.value === v)?.label || v

  return (
    <SheetV3 open={open} onClose={onClose} title="New event">
      <div style={{ display: 'grid', gap: 14 }}>
        <input className="m-input" autoFocus value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Add title" style={{ fontSize: '1.15rem', fontWeight: 600 }} />

        <div className="m-muted" style={{ fontSize: '0.85rem' }}>
          📅 {date} · <strong style={{ color: 'var(--text)' }}>{labelFor(startT)} – {labelFor(endT)}</strong>
          <span style={{ marginLeft: 6 }}>(go back to change the date)</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="m-input" value={startT} onChange={e => setStartT(e.target.value)}>
            {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span style={{ color: 'var(--text-2)' }}>→</span>
          <select className="m-input" value={endT} onChange={e => setEndT(e.target.value)}>
            {endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label className="m-label">Venue</label>
          <div className="v-pickgrid">
            {VENUES.map(v => (
              <button key={v.key} type="button" className={`v-pick ${venue === v.key ? 'v-pick--on' : ''}`}
                onClick={() => { haptic(); setVenue(v.key) }}>
                <span className="v-pick__label"><span className="v-pick__dot" style={{ background: v.color }} />{v.label}</span>
                <span className="v-pick__sub">{v.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {isOnline && (
          <div>
            <label className="m-label">Meeting link</label>
            <input className="m-input" value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet…" />
          </div>
        )}

        <div>
          <label className="m-label">Groups</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            <button type="button" className={`m-chip ${allGroupsOn ? 'm-chip--active' : ''}`} onClick={() => { haptic(); toggleAll() }}>Select all</button>
            {GROUPS.map(g => (
              <button key={g.key} type="button" className={`m-chip ${groups.includes(g.key) ? 'm-chip--active' : ''}`}
                onClick={() => { haptic(); toggleGroup(g.key) }}>{g.label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="m-label">Color</label>
          <div className="v-swatches">
            <button type="button" className={`v-swatch v-swatch--auto ${color === null ? 'v-swatch--on' : ''}`}
              onClick={() => { haptic(); setColor(null) }} title="Auto (venue color)">A</button>
            {EVENT_COLORS.map(c => (
              <button key={c} type="button" className={`v-swatch ${color === c ? 'v-swatch--on' : ''}`}
                style={{ background: c }} onClick={() => { haptic(); setColor(c) }} />
            ))}
          </div>
        </div>

        {clashes.length > 0 && (
          <div className="v-clash">
            <div className="v-clash__head"><AlertTriangle size={16} /> Scheduling conflict</div>
            {clashes.map(c => (
              <div key={c.event_id} className="v-clash__item">
                <div className="v-clash__name">{c.title}</div>
                <div className="v-clash__tags">
                  {c.venue_clash && <span className="v-clash__tag">Same room</span>}
                  {c.student_clash && <span className="v-clash__tag v-clash__tag--block">{c.shared_student_count} shared student{c.shared_student_count > 1 ? 's' : ''}</span>}
                </div>
                {(c.venue_bookings || []).map(vb => (
                  <div key={vb.booking_id} className="v-clash__row">
                    <span className="v-clash__room">{vb.resource_name} · held by <strong>{vb.holder_name}</strong></span>
                    {requested[vb.booking_id]
                      ? <span className="v-clash__sent">Sent ✓</span>
                      : <button type="button" className="v-clash__btn" disabled={sending === vb.booking_id} onClick={() => sendRequest(vb)}>
                          {sending === vb.booking_id ? 'Sending…' : 'Request'}
                        </button>}
                  </div>
                ))}
              </div>
            ))}
            {hasStudentClash && <div className="v-clash__block">Students here are already booked at this time — this slot can’t be booked. Pick another time.</div>}
          </div>
        )}

        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} disabled={hasStudentClash} onClick={submit}>Create event</Btn>
      </div>
    </SheetV3>
  )
}
