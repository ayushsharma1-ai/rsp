import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import { format, addWeeks, addDays, startOfDay, endOfDay, parseISO } from 'date-fns'
import { AlertTriangle, Globe, Lock, Repeat, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, HelpCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Btn, useSnack } from '../mobile/ui'
import { TIME_SLOTS, toISO, errText } from '../mobile/lib'
import { haptic, useTheme } from '../mobile/theme'
import SheetV3 from './SheetV3'
import DayGrid from './DayGrid'
import DateJump from './DateJump'
import TimeRange, { label12, timeRangeError } from './TimeRange'
import { useBackClose } from './useBackClose'
import { venueColorForName, UNTAGGED, eventColorFor } from './config'

// The venue list is built from the REAL rooms in the database (/resources), not a
// hardcoded list. A fixed list could drift from reality and — because the old
// name-matching failed silently — you could "book" a room that was never reserved.
// 'online' is the one pseudo-venue that has no room behind it.
const ONLINE = 'online'
// ...and TBD is the other: "the room isn't decided yet". It reserves NOTHING, so
// the event shows on the calendar and blocks nobody — exactly what a timetable
// entry with no allotted room needs. Set the real room later via Edit > Venue.
const TBD = 'tbd'

// How many rooms the venue picker shows before "N more rooms". Six fills two rows on
// a phone; the department has 21, which as one block pushed Groups and Visibility
// clean off the bottom of the sheet.
const VENUE_PREVIEW = 6

// Convert between the 'yyyy-MM-dd' strings this form stores and the Date objects
// DateJump speaks, so the jump-to-any-date calendar can be reused here.
// Returns null (never an Invalid Date) when the string is missing or unparseable.
// `day` is seeded from a prop that is undefined until the sheet is opened, so this
// IS hit in normal use — an Invalid Date reaching date-fns `format()` throws and
// blanks the screen.
const asDate = (s) => {
  if (!s) return null
  const d = parseISO(`${s}T00:00`)
  return Number.isNaN(d.getTime()) ? null : startOfDay(d)
}
const asStr = (d) => format(d, 'yyyy-MM-dd')

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

// The earliest slot on `date` that isn't already gone — or null for any future
// day, where nothing is in the past and so nothing should be clamped. It used to
// answer '09:00' for future days, which silently dragged a 1 AM pick up to 9 AM.
const pastFloor = (date) => {
  const now = new Date()
  if (format(now, 'yyyy-MM-dd') !== date) return null
  const mins = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30
  const v = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  return TIME_SLOTS.find(s => s.value === v) ? v : TIME_SLOTS[TIME_SLOTS.length - 1].value
}

// Google-Calendar-style create: opened from a tapped/selected slot (date + time
// seeded from the calendar box). Field order: Title → Venue → Groups → Kind.
// Event colour comes from the chosen KIND (no per-event colour picker).
//
// You fill the details FIRST, then a venue clash becomes a fork: move to another
// time (details kept) or ask the holder for this one (details sent with the request,
// so they can judge it, and so the event is placed automatically if they accept).
// No draft event is ever stored — until someone accepts, it lives on the request.
// (Student clash removed 2026-06-18.)
// `requestFor` is set when you arrived by tapping "Request this slot" on someone
// else's event. Without it you landed in a blank "New event" form with no idea
// why you were being asked for a title — the sheet now says so up front.
export default function CreateEventV3({ open, onClose, onCreated, date, start, end, prefill, requestFor }) {
  const snack = useSnack()
  const { user } = useAuthStore()
  const [theme] = useTheme()   // venue dots differ per theme (see config.js)
  // The sheet owns its date after opening, so "pick another time" can move to a
  // different day without the reset effect firing and wiping what you've typed.
  const [day, setDay] = useState(date)
  const [picking, setPicking] = useState(false)
  const [venuesOpen, setVenuesOpen] = useState(false)   // venue list expanded past the preview
  const [title, setTitle] = useState('')
  const [venue, setVenue] = useState('')   // a real resource id, or ONLINE
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
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const floor = pastFloor(date)
    let s = start || floor || '09:00'                     // nothing picked → next free slot, else 9 AM
    if (floor && s < floor) s = floor                     // today only: never open in the past
    // The grid runs 8 AM–9 PM; don't default into hours the calendar doesn't show.
    if (s < '08:00') s = '08:00'
    const e = (end && end > s) ? end : slotAfter(s, 2)    // default 1h, always after start
    // Normalise the incoming date ONCE. Every line below derives from it, and a
    // missing/!unparseable value made format()/getDay() throw or yield NaN — which
    // inside an effect still tears the tree down to a blank screen.
    const d0 = (date && !Number.isNaN(new Date(`${date}T00:00`).getTime()))
      ? date : format(new Date(), 'yyyy-MM-dd')
    setDay(d0)
    // `prefill` carries the details of a request that was declined, so trying a
    // different slot doesn't mean typing everything out a second time.
    setTitle(prefill?.title || '')
    setVenue(prefill ? (prefill.resource_id || ONLINE) : '')
    setLink(prefill?.link || '')
    setGroups(prefill?.group_ids || [])
    setIsPublic(true)
    setStartT(s); setEndT(e)
    // default a weekly series to the chosen day, running ~a term (12 weeks)
    setRepeat('none')
    setByday([dayCodeOf(d0)])
    setUntil(format(addWeeks(new Date(`${d0}T00:00`), 12), 'yyyy-MM-dd'))
    setError(''); setClashes([]); setSending(false); setPicking(false); setVenuesOpen(false)
    api.get('/resources').then(r => setResources(r.data)).catch(() => {})
    api.get('/groups').then(r => setRealGroups(r.data)).catch(() => {})
    api.get('/event-kinds').then(r => {
      setKinds(r.data)
      setKindId(prev => prev || r.data[0]?.id || null)
    }).catch(() => {})
    // `prefill` is deliberately NOT a dependency: it arrives in the same render that
    // flips `open`, and it's a fresh object each time — listing it would reset the
    // form on every render and wipe what you're typing.
  }, [open, start, end, date]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real, bookable rooms straight from the API — no name-matching, no drift.
  const rooms = resources.filter(r => r.is_active !== false)
  const isOnline = venue === ONLINE
  const isTbd = venue === TBD
  // Venue list: show a few, rest behind "More". Six fills two rows on a phone without
  // pushing Groups and Visibility off the bottom of the sheet.
  const shownRooms = venuesOpen ? rooms : (() => {
    const head = rooms.slice(0, VENUE_PREVIEW)
    // The SELECTED room must always be on screen. Editing an event held in the 15th
    // room would otherwise open with nothing highlighted, which reads as "no room
    // chosen" and invites you to pick one — silently moving the booking.
    if (venue && !head.some(r => r.id === venue)) {
      const sel = rooms.find(r => r.id === venue)
      if (sel) return [sel, ...head.slice(0, VENUE_PREVIEW - 1)]
    }
    return head
  })()
  const hiddenVenues = rooms.length - shownRooms.length
  const collapsedVenues = !venuesOpen && hiddenVenues > 0
  // Both pseudo-venues reserve no room, so neither maps to a resource.
  const mappedResource = (isOnline || isTbd) ? null : (rooms.find(r => r.id === venue) || null)
  // `groups` holds REAL group ids straight from /groups — no name-matching.
  const groupIds = groups

  // Once the real rooms arrive, select a sensible default — the first bookable
  // room, or Online if the department hasn't added any rooms yet. Also repairs a
  // selection that no longer exists (e.g. the room was deactivated).
  // Wait for the list: while it's still empty every id looks unknown, so running
  // early would knock a valid prefilled room straight over to Online.
  useEffect(() => {
    if (!open || resources.length === 0) return
    setVenue(v => (v === ONLINE || v === TBD || rooms.some(r => r.id === v)) ? v : (rooms[0]?.id || ONLINE))
  }, [open, resources]) // eslint-disable-line react-hooks/exhaustive-deps

  // live clash preview (venue only)
  useEffect(() => {
    if (!open) return
    if (endT <= startT) { setClashes([]); return }
    const resource_ids = mappedResource ? [mappedResource.id] : []
    if (resource_ids.length === 0 && groupIds.length === 0) { setClashes([]); return }
    const startISO = toISO(day, startT), endISO = toISO(day, endT)
    let cancelled = false
    api.post('/clashes/preview', { start_time: startISO, end_time: endISO, group_ids: groupIds, resource_ids })
      .then(r => { if (!cancelled) setClashes(r.data) }).catch(() => {})
    return () => { cancelled = true }
  }, [open, day, startT, endT, venue, groups.join(','), resources.length, realGroups.length])

  // Only venue clashes matter now (student clashes are ignored).
  const venueClashes = clashes.filter(c => c.venue_clash)
  // Every held booking standing in our way — all must be freed for the slot to
  // open, so "request" asks all of them, not just the first. But split by WHO
  // holds it: you can ask a colleague to release theirs, you cannot request your
  // own slot from yourself. The API rejects that ("You already hold this slot"),
  // and sending blind used to abort the batch halfway, AFTER real requests had
  // already gone out — an error message on a half-done action.
  const heldBookings = venueClashes.flatMap(c => c.venue_bookings || [])
  const theirBookings = heldBookings.filter(b => b.holder_id !== user?.id)
  const myBookings = heldBookings.filter(b => b.holder_id === user?.id)
  const holderNames = [...new Set(theirBookings.map(b => b.holder_name).filter(Boolean))]
  const allGroupsOn = realGroups.length > 0 && groups.length === realGroups.length
  const toggleGroup = (id) => setGroups(g => g.includes(id) ? g.filter(x => x !== id) : [...g, id])
  const toggleAll = () => setGroups(allGroupsOn ? [] : realGroups.map(g => g.id))

  // Ask for the contested slot. The details you've filled in travel WITH the
  // request, so the holder decides knowing what it's for — and if they accept,
  // the backend frees the slot and creates this event in one transaction.
  const requestSlot = async () => {
    if (sending) return
    if (!title.trim()) { setError('Add a title first.'); return }
    setSending(true); setError('')
    try {
      for (const vb of theirBookings) {
        await api.post('/release-requests', {
          booking_id: vb.booking_id, message: '',
          proposed_event: {
            title: title.trim(), description: isOnline ? `Online meeting: ${link.trim()}` : '',
            start_time: toISO(day, startT), end_time: toISO(day, endT),
            resource_id: vb.resource_id, group_ids: groupIds, category: 'adhoc',
          },
        })
      }
      const who = holderNames.length ? holderNames.join(' and ') : 'the slot holder'
      snack(`Request sent to ${who} — ${dayLabel} · ${labelFor(startT)}–${labelFor(endT)}`)
      onClose && onClose()
    } catch {
      setError('Could not send the request — try again.')
    } finally {
      setSending(false)
    }
  }

  const submit = async () => {
    setError('')
    if (!title.trim()) { setError('Give the event a title.'); return }
    // Same rule the picker shows live: inside 8 AM–9 PM, end after start, and
    // (today only) not already in the past.
    const tErr = timeRangeError(startT, endT, pastFloor(day))
    if (tErr) { setError(tErr); return }
    if (new Date(toISO(day, startT)) < new Date()) { setError("You can't create an event in the past."); return }
    if (isOnline && !link.trim()) { setError('Add a meeting link for the online event.'); return }
    // Fail LOUDLY rather than silently creating an event that reserves no room —
    // that was the old bug: two people could "book" the same room and never be told.
    // "Not decided yet" (TBD) is the ONE deliberate exception: the user is telling us
    // on purpose that no room is allotted, so reserving nothing is the correct result.
    if (!isOnline && !isTbd && !mappedResource) {
      setError(rooms.length === 0
        ? 'No rooms exist. Ask an admin.'
        : 'Choose a room for this event.')
      return
    }
    if (repeat === 'weekly') {
      if (byday.length === 0) { setError('Pick at least one day to repeat on.'); return }
      if (!until) { setError('Choose the date the series ends.'); return }
      if (until < day) { setError('The series must end on or after the first date.'); return }
    }
    setLoading(true)
    try {
      const startISO = toISO(day, startT), endISO = toISO(day, endT)
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
      setError(errText(err, 'Could not create — that slot may be busy.'))
    } finally { setLoading(false) }
  }

  const labelFor = (v) => label12(v)
  // The sheet's children still render while it's closed, and then there's no date
  // at all — so never hand an unparseable string to format().
  const dayLabel = day ? format(new Date(`${day}T00:00`), 'EEE, d MMM') : ''
  return (
    <SheetV3 open={open} onClose={onClose} title={requestFor ? 'Request this slot' : 'New event'}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
        {requestFor && (
          <div className="v-reqnote">
            <div className="v-reqnote__head">Requesting {requestFor.room} from {requestFor.holder || 'the holder'}</div>
            {/* says WHY the form opened — the one thing the title alone can't.
                Tone matters here: a colleague is asking a colleague for a room, so
                this reads as a courteous request, not a claim on their slot.
                Do NOT imply first-come-first-served: the holder chooses which
                request to accept, and nothing in the backend enforces an order. */}
            <p>{requestFor.when}. Nothing changes until they accept.</p>
          </div>
        )}

        {/* WHAT and WHEN are one unit. These were three siblings separated by the
            sheet's standard gap, so a title, a date and a time range read as three
            unrelated questions stacked up — the "scattered" complaint. They answer one
            question ("what is happening, and when"), so they share one bordered card
            with hairline dividers, the way Google's own create sheet groups them.
            Everything below — Repeats, Venue, Groups — stays a separate block, because
            those genuinely are separate decisions. */}
        <div className="v-fieldgroup">
          {/* no autoFocus: on iOS it summoned the keyboard the instant the sheet
              opened, hiding the upper half of the form behind it (audit, item 4).
              Tap the field and SheetV3 scrolls it into the visible area instead. */}
          <input className="v-fieldgroup__title" value={title} onChange={e => setTitle(e.target.value)}
            placeholder={requestFor ? 'What is it for?' : 'Add title'} />

          {/* The date is a real control now, not read-only text: tap it to jump to ANY
              date (same calendar the move/reschedule screens use). "Pick on the day grid"
              stays for choosing a time against the day's other events. */}
          <div className="v-fieldgroup__row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DateJump day={asDate(day)} onPick={(d) => setDay(asStr(d))} fmt="EEE, d MMM" />
            <button type="button" className="m-link"
              onClick={() => { haptic(); setPicking(true) }}>Pick on grid</button>
          </div>

          <div className="v-fieldgroup__row">
            <TimeRange start={startT} end={endT} minStart={pastFloor(day)}
              onChange={({ start: s, end: e }) => { setStartT(s); setEndT(e) }} />
          </div>
        </div>

        <div>
          <label className="m-label">Repeats</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            <button type="button" className={`m-chip ${repeat === 'none' ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); setRepeat('none') }}>Once</button>
            <button type="button" className={`m-chip ${repeat === 'weekly' ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); setRepeat('weekly') }}>
              <Repeat size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Weekly
            </button>
          </div>

          {repeat === 'weekly' && (
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
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
                {/* Same tap-to-jump calendar as everywhere else, instead of a bare
                    native date box, so choosing a term-end date feels identical. */}
                <DateJump day={asDate(until || day)} fmt="EEE, d MMM yyyy"
                  onPick={(d) => setUntil(asStr(d))} />
              </div>
              <div className="m-muted" style={{ fontSize: '0.76rem' }}>
                Single occurrences stay editable.
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="m-label">Venue</label>
          {resources.length === 0 ? (
            <div className="v-clash" style={{ marginTop: 0 }}>
              <div className="v-clash__head"><AlertTriangle size={16} /> No rooms added yet</div>
              <div style={{ fontSize: '0.84rem', marginTop: 4 }}>
                No rooms yet. Online events still work.
              </div>
            </div>
          ) : null}
          {/* Show a handful, hide the rest. 21 rooms is a wall of chips between the time
              and everything below it, and most events use one of a few familiar rooms.
              The collapsed grid FADES at its bottom edge rather than ending flat, so it
              reads as "there is more" instead of "that is all" — a hard edge is exactly
              what makes people miss a "More" button underneath it. */}
          <div className={`v-pickgrid ${collapsedVenues ? 'v-pickgrid--faded' : ''}`}>
            {shownRooms.map(r => (
              <button key={r.id} type="button" className={`v-pick ${venue === r.id ? 'v-pick--on' : ''}`}
                onClick={() => { haptic(); setVenue(r.id) }}>
                <span className="v-pick__label">
                  <span className="v-pick__dot" style={{ background: venueColorForName(r.name, theme) }} />{r.name}
                </span>
                <span className="v-pick__sub">{r.location || r.description || 'Room'}</span>
              </button>
            ))}
            <button type="button" className={`v-pick ${isOnline ? 'v-pick--on' : ''}`}
              onClick={() => { haptic(); setVenue(ONLINE) }}>
              <span className="v-pick__label">
                <span className="v-pick__dot" style={{ background: venueColorForName(null, theme) }} />Online
              </span>
              <span className="v-pick__sub">Meeting link</span>
            </button>
            {/* For a class whose room isn't allotted yet. Reserves nothing, so it
                can't clash with anyone and anyone can still book the rooms. */}
            <button type="button" className={`v-pick ${isTbd ? 'v-pick--on' : ''}`}
              onClick={() => { haptic(); setVenue(TBD) }}>
              <span className="v-pick__label">
                <span className="v-pick__dot" style={{ background: 'var(--text-3)' }} />Not decided yet
              </span>
              <span className="v-pick__sub">Decide later</span>
            </button>
          </div>
          {hiddenVenues > 0 && (
            <button type="button" className="v-morebtn"
              onClick={() => { haptic(); setVenuesOpen(true) }}>
              {hiddenVenues} more {hiddenVenues === 1 ? 'room' : 'rooms'}
              <ChevronDown size={15} />
            </button>
          )}
          {venuesOpen && rooms.length > VENUE_PREVIEW && (
            <button type="button" className="v-morebtn"
              onClick={() => { haptic(); setVenuesOpen(false) }}>
              Show fewer
              <ChevronUp size={15} />
            </button>
          )}
        </div>

        {isTbd && (
          <div className="m-muted" style={{ fontSize: '0.8rem', display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: -4 }}>
            <HelpCircle size={14} style={{ flex: '0 0 auto', marginTop: 2 }} />
            <span>No room reserved. Add one later.</span>
          </div>
        )}

        {isOnline && (
          <div>
            <label className="m-label">Meeting link</label>
            <input className="m-input" value={link} onChange={e => setLink(e.target.value)} placeholder="https://meet…" />
          </div>
        )}

        <div>
          <label className="m-label">Groups</label>
          {realGroups.length === 0 ? (
            <div className="m-muted" style={{ fontSize: '0.82rem' }}>
              No groups yet.
            </div>
          ) : (
            <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
              <button type="button" className={`m-chip ${allGroupsOn ? 'm-chip--active' : ''}`} onClick={() => { haptic(); toggleAll() }}>Select all</button>
              {realGroups.map(g => (
                <button key={g.id} type="button" className={`m-chip ${groups.includes(g.id) ? 'm-chip--active' : ''}`}
                  onClick={() => { haptic(); toggleGroup(g.id) }}>{g.name}</button>
              ))}
            </div>
          )}
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
            {isPublic ? 'Anyone can see it.' : 'Only you and admins.'}
          </div>
        </div>

        {/* A clash is a decision point, so show both roads instead of a dead end.
            Either way the details above survive — they move to the new time, or
            they travel to the holder as the request. */}
        {venueClashes.length > 0 && (
          <div className="v-clash">
            <div className="v-clash__head"><AlertTriangle size={16} /> Room booked</div>
            {venueClashes.map(c => (
              <div key={c.event_id} className="v-clash__item">
                <div className="v-clash__name">{c.title}</div>
                {(c.venue_bookings || []).map(vb => (
                  <div key={vb.booking_id} className="v-clash__row">
                    <span className="v-clash__room">
                      {vb.resource_name} · held by <strong>{vb.holder_id === user?.id ? 'you' : vb.holder_name}</strong>
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {repeat === 'weekly' ? (
              <>
                <div className="v-clash__fork">
                  <Btn full onClick={() => { haptic(); setPicking(true) }}>Pick another time</Btn>
                </div>
                <div className="v-clash__hint">
                  Series need a slot free all term.
                </div>
              </>
            ) : theirBookings.length === 0 ? (
              /* Everything in the way is your OWN booking — there's nobody to ask. */
              <>
                <div className="v-clash__fork">
                  <Btn full onClick={() => { haptic(); setPicking(true) }}>Pick another time</Btn>
                </div>
                <div className="v-clash__hint">
                  This is your own booking. Move it yourself.
                </div>
              </>
            ) : (
              <>
                <div className="v-clash__fork">
                  <Btn full onClick={() => { haptic(); setPicking(true) }}>Pick another time</Btn>
                  <Btn full variant="primary" loading={sending} onClick={requestSlot}>
                    {holderNames.length > 1 ? `Ask all ${holderNames.length}` : 'Request slot'}
                  </Btn>
                </div>
                {/* No rule stated here. This used to promise "the earliest request
                    comes first", which the backend never enforced — `accept()` lets
                    the holder take ANY open request, in any order (verified
                    2026-07-30). Do NOT reintroduce a first-come-first-served claim,
                    and don't replace it with an explanation either: the button says
                    what happens, and who it goes to is already in the banner above.
                    The only line left is the one the user cannot infer — that their
                    OWN booking is part of the clash. */}
                {myBookings.length > 0 && (
                  <div className="v-clash__hint">Your booking also overlaps.</div>
                )}
              </>
            )}
          </div>
        )}

        {error && <p className="m-error">{error}</p>}
        {venueClashes.length === 0 && (
          <Btn variant="primary" full loading={loading} onClick={submit}>Create event</Btn>
        )}
      </div>

      {picking && (
        <PickTimeOverlay day={day} onClose={() => setPicking(false)}
          onPick={(d, s, e) => { setDay(d); setStartT(s); setEndT(e); setPicking(false) }} />
      )}
    </SheetV3>
  )
}

// Full-screen day grid for choosing a different slot — shows what's already on
// that day so you can land somewhere free. Only the date and time come back;
// everything typed into the create sheet is left alone.
function PickTimeOverlay({ day, onClose, onPick }) {
  const [theme] = useTheme()
  const [cursor, setCursor] = useState(() => startOfDay(new Date(`${day}T00:00`)))
  const [events, setEvents] = useState(null)
  useBackClose(true, onClose)

  useEffect(() => {
    let cancelled = false
    setEvents(null)
    api.get('/events/calendar', {
      params: { start: startOfDay(cursor).toISOString(), end: endOfDay(cursor).toISOString() },
    })
      .then(r => { if (!cancelled) setEvents(r.data || []) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [cursor])

  return ReactDOM.createPortal(
    <div className="v-moveoverlay" style={{ zIndex: 1100 }}>
      <div className="v-moveoverlay__head">
        <button className="v-iconbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Pick another time</div>
        </div>
        <div style={{ width: 40, flex: '0 0 40px' }} />
      </div>

      <div className="v-moveoverlay__nav">
        <button className="v-iconbtn" onClick={() => setCursor(d => addDays(d, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
        {/* was a static label — you could only step one day at a time here, while the
            move/reschedule screens let you jump. Same control now, everywhere. */}
        <DateJump day={cursor} onPick={setCursor} />
        <button className="v-iconbtn" onClick={() => setCursor(d => addDays(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      <div className="v-moveoverlay__body">
        <DayGrid cursor={cursor} today={new Date()} events={events || []}
          eventColor={(e) => eventColorFor(e, theme)} confirmLabel="Use this time"
          onConfirm={(s, e) => onPick(format(cursor, 'yyyy-MM-dd'), s, e)} />
      </div>
    </div>,
    document.body,
  )
}
