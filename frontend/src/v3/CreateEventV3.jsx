import React, { useEffect, useState } from 'react'
import { format, addWeeks } from 'date-fns'
import { AlertTriangle, Globe, Lock, Repeat } from 'lucide-react'
import api from '../lib/api'
import { Btn, useSnack } from '../mobile/ui'
import { TIME_SLOTS, toISO } from '../mobile/lib'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'
import { VENUES, GROUPS, resourceForVenue, groupIdForLabel } from './config'

// The TIME_SLOTS value `steps` half-hours after `value` (clamped to the last slot).
const slotAfter = (value, steps) => {
  const i = TIME_SLOTS.findIndex(s => s.value === value)
  return TIME_SLOTS[Math.min((i < 0 ? 0 : i) + steps, TIME_SLOTS.length - 1)].value
}
// ---- recurrence helpers -------------------------------------------------
// RRULE weekday codes, indexed by JS getDay() (0 = Sunday).
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
// Chips in Mon-first order, the way a timetable reads.
const WEEK_CHIPS = [['MO', 'M'], ['TU', 'T'], ['WE', 'W'], ['TH', 'T'], ['FR', 'F'], ['SA', 'S'], ['SU', 'S']]
const dayCodeOf = (dateStr) => RRULE_DAYS[new Date(`${dateStr}T00:00`).getDay()]
const minutesBetween = (a, b) => {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return (bh * 60 + bm) - (ah * 60 + am)
}

// Earliest slot that isn't in the past for `date`: today → round now up to :00/:30; otherwise 09:00.
const futureDefaultStart = (date) => {
  const now = new Date()
  if (format(now, 'yyyy-MM-dd') !== date) return '09:00'
  const mins = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30
  const v = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return TIME_SLOTS.find(s => s.value === v) ? v : TIME_SLOTS[TIME_SLOTS.length - 1].value
}

// Google-Calendar-style create: opened from a tapped/selected slot (date + time
// fixed from the calendar box). Field order: Title → Venue → Groups → Kind.
// Event colour comes from the chosen KIND (no per-event colour picker).
// Venue clash = one-tap release request. (Student clash removed 2026-06-18.)
export default function CreateEventV3({ open, onClose, onCreated, date, start, end }) {
  const snack = useSnack()
  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('601H-N')
  const [link, setLink] = useState('')
  const [groups, setGroups] = useState([])
  const [kinds, setKinds] = useState([])
  const [kindId, setKindId] = useState(null)        // chosen event type → drives colour
  const [isPublic, setIsPublic] = useState(true)    // public = visible on the open calendar
  const [repeat, setRepeat] = useState('none')      // 'none' | 'weekly'
  const [byday, setByday] = useState([])            // ['MO','WE'] — weekly only
  const [until, setUntil] = useState('')            // yyyy-MM-dd — last day of the series
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
    const floor = futureDefaultStart(date)
    let s = start || floor
    if (s < floor) s = floor                              // never default into the past
    const e = (end && end > s) ? end : slotAfter(s, 2)    // default 1h, always after start
    setTitle(''); setVenue('601H-N'); setLink(''); setGroups([]); setIsPublic(true)
    setStartT(s); setEndT(e)
    // default a weekly series to the chosen day, running ~a term (12 weeks)
    setRepeat('none')
    setByday([dayCodeOf(date)])
    setUntil(format(addWeeks(new Date(`${date}T00:00`), 12), 'yyyy-MM-dd'))
    setError(''); setClashes([]); setRequested({})
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
    api.get('/groups').then(r => setRealGroups(r.data)).catch(() => {})
    api.get('/event-kinds').then(r => {
      setKinds(r.data)
      setKindId(prev => prev || r.data[0]?.id || null)
    }).catch(() => {})
  }, [open, start, end, date])

  const venueObj = VENUES.find(v => v.key === venue)
  const isOnline = !!venueObj?.online
  const mappedResource = !isOnline ? resourceForVenue(venueObj, resources) : null
  const groupIds = groups.map(k => groupIdForLabel(GROUPS.find(g => g.key === k).label, realGroups)).filter(Boolean)

  // live clash preview (venue only)
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

  // Only venue clashes matter now (student clashes are ignored).
  const venueClashes = clashes.filter(c => c.venue_clash)
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
    if (new Date(toISO(date, startT)) < new Date()) { setError("You can't create an event in the past."); return }
    if (isOnline && !link.trim()) { setError('Add a meeting link for the online event.'); return }
    if (repeat === 'weekly') {
      if (byday.length === 0) { setError('Pick at least one day to repeat on.'); return }
      if (!until) { setError('Choose the date the series ends.'); return }
      if (until < date) { setError('The series must end on or after the first date.'); return }
    }
    setLoading(true)
    try {
      const startISO = toISO(date, startT), endISO = toISO(date, endT)
      const description = isOnline ? `Online meeting: ${link.trim()}` : ''

      if (repeat === 'weekly') {
        // A series: one root event + one rule + one booking template (no row explosion).
        await api.post('/events/recurring', {
          title: title.trim(),
          description,
          rrule: `FREQ=WEEKLY;BYDAY=${byday.join(',')}`,
          series_start: startISO,
          series_end_date: toISO(until, endT),
          duration_minutes: minutesBetween(startT, endT),
          resource_id: mappedResource ? mappedResource.id : null,
          is_public: isPublic,
          notes: '',
          group_ids: groupIds,
          event_kind_id: kindId,
        })
        haptic(12); snack('Recurring event created'); onCreated && onCreated()
      } else {
        const bookings = mappedResource ? [{ resource_id: mappedResource.id, start_time: startISO, end_time: endISO, notes: '' }] : []
        await api.post('/events', { title: title.trim(), description, start_time: startISO, end_time: endISO, is_public: isPublic, bookings, group_ids: groupIds, category: 'adhoc', event_kind_id: kindId })
        haptic(12); snack('Event created'); onCreated && onCreated()
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Could not create — that slot may be busy.')
    } finally { setLoading(false) }
  }

  const isTodayDate = format(new Date(), 'yyyy-MM-dd') === date
  const startSlots = isTodayDate ? TIME_SLOTS.filter(s => s.value >= futureDefaultStart(date)) : TIME_SLOTS
  const endSlots = TIME_SLOTS.filter(s => s.value > startT)
  const labelFor = (v) => TIME_SLOTS.find(s => s.value === v)?.label || v
  // Changing the start shifts the end to keep the same duration, so the header
  // text, the end dropdown, and state never disagree (end always stays after start).
  const changeStart = (v) => {
    const dur = Math.max(1, TIME_SLOTS.findIndex(x => x.value === endT) - TIME_SLOTS.findIndex(x => x.value === startT))
    setStartT(v)
    setEndT(slotAfter(v, dur))
  }

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
          <select className="m-input" value={startT} onChange={e => changeStart(e.target.value)}>
            {startSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span style={{ color: 'var(--text-2)' }}>→</span>
          <select className="m-input" value={endT} onChange={e => setEndT(e.target.value)}>
            {endSlots.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label className="m-label">Repeats</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            <button type="button" className={`m-chip ${repeat === 'none' ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); setRepeat('none') }}>Does not repeat</button>
            <button type="button" className={`m-chip ${repeat === 'weekly' ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); setRepeat('weekly') }}>
              <Repeat size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Weekly
            </button>
          </div>

          {repeat === 'weekly' && (
            <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
              <div>
                <div className="m-muted" style={{ fontSize: '0.78rem', marginBottom: 6 }}>On these days</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {WEEK_CHIPS.map(([code, label]) => (
                    <button key={code} type="button"
                      className={`m-chip ${byday.includes(code) ? 'm-chip--active' : ''}`}
                      style={{ flex: 1, justifyContent: 'center', padding: '8px 0', minWidth: 0 }}
                      onClick={() => { haptic(); setByday(d => d.includes(code) ? d.filter(x => x !== code) : [...d, code]) }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="m-muted" style={{ fontSize: '0.78rem', marginBottom: 6 }}>Until</div>
                <input className="m-input" type="date" value={until} min={date}
                  onChange={e => setUntil(e.target.value)} />
              </div>
              <div className="m-muted" style={{ fontSize: '0.76rem' }}>
                Creates one series (e.g. a weekly class) — not dozens of separate events.
                You can change or cancel a single occurrence later without touching the rest.
              </div>
            </div>
          )}
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
          <label className="m-label">Kind</label>
          {kinds.length === 0
            ? <div className="m-muted" style={{ fontSize: '0.85rem' }}>No event kinds defined yet.</div>
            : <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
                {kinds.map(k => (
                  <button key={k.id} type="button" className={`m-chip ${kindId === k.id ? 'm-chip--active' : ''}`}
                    onClick={() => { haptic(); setKindId(k.id) }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: k.color, marginRight: 6, verticalAlign: 'middle' }} />
                    {k.name}
                  </button>
                ))}
              </div>}
        </div>

        <div>
          <label className="m-label">Visibility</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            <button type="button" className={`m-chip ${isPublic ? 'm-chip--active' : ''}`} onClick={() => { haptic(); setIsPublic(true) }}>
              <Globe size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Public
            </button>
            <button type="button" className={`m-chip ${!isPublic ? 'm-chip--active' : ''}`} onClick={() => { haptic(); setIsPublic(false) }}>
              <Lock size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Private
            </button>
          </div>
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6, marginLeft: 2 }}>
            {isPublic ? 'Anyone viewing the calendar can see this event.' : 'Hidden from the public calendar — only you and admins can see it.'}
          </div>
        </div>

        {venueClashes.length > 0 && (
          <div className="v-clash">
            <div className="v-clash__head"><AlertTriangle size={16} /> Room already booked</div>
            {venueClashes.map(c => (
              <div key={c.event_id} className="v-clash__item">
                <div className="v-clash__name">{c.title}</div>
                <div className="v-clash__tags"><span className="v-clash__tag">Same room</span></div>
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
          </div>
        )}

        {error && <p className="m-error">{error}</p>}
        <Btn variant="primary" full loading={loading} disabled={venueClashes.length > 0} onClick={submit}>
          {venueClashes.length > 0 ? 'Room taken — request it above' : 'Create event'}
        </Btn>
      </div>
    </SheetV3>
  )
}
