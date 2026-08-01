import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, startOfWeek, addMonths, addWeeks, addDays,
  startOfDay, endOfDay, isSameDay, isSameMonth, isSameWeek, parseISO,
} from 'date-fns'

// Week grid starts on Monday (Mon…Sun), same as the month grid. Kept in ONE place so
// the week view, the fetch range, and the "today on screen" check can't drift apart —
// that alignment is what keeps each weekday in a FIXED column as you page weeks, so
// nothing appears to jump sideways when you navigate.
const WEEK_OPTS = { weekStartsOn: 1 }

// Sentinel for "this event reserves no room" in the Edit sheet's venue picker.
// It maps to an explicit null on the wire, which the API reads as "remove the room".
const ROOM_NONE = '__none__'
// Order-insensitive comparison, so re-picking the same groups isn't seen as a change.
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
import { ChevronLeft, ChevronRight, CalendarPlus, ArrowLeftRight, Filter, Check, X } from 'lucide-react'
import api from '../lib/api'
import { addToCalendar } from '../lib/ics'
import { useAuthStore } from '../store/authStore'
import { Btn, DetailRow, useSnack } from '../mobile/ui'
import { toISO, errText } from '../mobile/lib'
import { label12 } from './TimeRange'
import { haptic, useTheme } from '../mobile/theme'
import { venueColorForName, readableOn, EVENT_COLORS, UNTAGGED, eventColorFor } from './config'
import { useAutoRefresh } from './useAutoRefresh'
import { useAuthGate } from './AuthGateV3'
import CreateEventV3 from './CreateEventV3'
import SheetV3 from './SheetV3'
import RecurringScopeSheet from './RecurringScopeSheet'
import DateJump from './DateJump'
import DayGrid from './DayGrid'
import { useBackClose } from './useBackClose'
import { useConfirm } from './ConfirmSheet'
import { DAY_START, DAY_END, WK_PX, evMins, scrollToHour, clampBand, stackOverlaps, WK_CASCADE_PX } from './dayConsts'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// SHY CHROME — scroll the grid down and the secondary rows (nav, filters, hints)
// tuck away so the hours get the room; scroll up and they return. Inline styles,
// not a class: min-height 0 beats the flex-item auto-minimum, and inline wins
// every cascade fight, so the collapse can't be silently overridden.
const shyStyle = (hide) => ({
  minHeight: 0, overflow: 'hidden',
  transition: 'max-height .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease, margin .28s cubic-bezier(.2,.8,.2,1)',
  maxHeight: hide ? 0 : 240,
  opacity: hide ? 0 : 1,
  pointerEvents: hide ? 'none' : undefined,
})

// Filters are built from the REAL rooms (/resources), so a room added in
// Settings > Rooms shows up here automatically. Events carry their room name,
// so we filter by exact name — no fuzzy matching, no "other" bucket.
// This sentinel covers events with no room at all (online / unassigned).
const NO_ROOM = '__no_room__'

// Filter model (e-commerce style, 2026-07-24): the sets hold what you've
// SELECTED, and an empty set means "show everything" (no filter). You start with
// nothing ticked and tick the cohorts/rooms you want — selecting narrows, exactly
// like Myntra/Google facets. Choices persist across navigation via localStorage.
const FILTERS_KEY = 'v3-filters-sel'
const readFiltersSel = () => {
  try {
    const v = JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}')
    return { rooms: Array.isArray(v.rooms) ? v.rooms : [], groups: Array.isArray(v.groups) ? v.groups : [] }
  } catch { return { rooms: [], groups: [] } }
}
// Same idea for cohorts: filter the calendar down to one group's timetable.
// Sentinel covers events not tagged to any group.
const NO_GROUP = '__no_group__'
// Per-group identity colours — a filter whose chips all share one colour can't
// differentiate anything (that was the bug: every group dot was var(--brand)).
// Assigned by list position, so colours are stable while the group list is.
//
// Drawn from EVENT_COLORS rather than re-listed here (2026-07-30). This used to be
// a hard-coded copy of the same eight hex values, so re-tuning the palette for the
// white theme fixed event blocks and room dots but left cohort chips on the old
// cream-era colours. Rotated by one so a cohort and an event kind at the same list
// position don't land on the same hue.
const GROUP_TAG_COLORS = [...EVENT_COLORS.slice(1), EVENT_COLORS[0]]

export function CalendarV3() {
  const { user } = useAuthStore()
  // Event/venue colours have a light and a dark variant; useTheme re-renders on toggle.
  const [theme] = useTheme()
  const snack = useSnack()
  const navigate = useNavigate()
  const location = useLocation()
  // View + date live in the URL so browser/hardware back returns to exactly
  // the previous view (week ⇄ month ⇄ day), not some default.
  const [sp, setSp] = useSearchParams()
  const view = sp.get('view') || 'week'               // 'week' | 'month' | 'day'
  // Memo on the param VALUE (not the sp object) so unrelated param changes
  // don't mint a new cursor identity and cascade into event refetches.
  const dParam = sp.get('d')
  const cursor = useMemo(() => {
    if (dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)) {
      const d = new Date(`${dParam}T00:00`)
      if (!isNaN(d)) return startOfDay(d)
    }
    return startOfDay(new Date())                     // malformed/missing → today
  }, [dParam])
  // View changes PUSH history (back undoes them); date stepping REPLACES
  // (back shouldn't crawl through every week you scrolled past).
  const go = useCallback((v, d, push = false) =>
    setSp({ view: v, d: format(d, 'yyyy-MM-dd') }, { replace: !push }), [setSp])
  const setView = (v) => go(v, cursor, true)
  const setCursor = (updater) => go(view, typeof updater === 'function' ? updater(cursor) : updater)
  const [events, setEvents] = useState(null)
  const [venueByEvent, setVenueByEvent] = useState({})
  const [rooms, setRooms] = useState([])                       // real rooms from /resources
  const [selRooms, setSelRooms] = useState(() => new Set())    // SELECTED rooms; empty = all
  const [groupList, setGroupList] = useState([])               // real cohorts from /groups
  const [selGroups, setSelGroups] = useState(() => new Set())  // SELECTED cohorts; empty = all
  const [sel, setSel] = useState(null)
  const [create, setCreate] = useState(null)          // {date, start, end}
  const [daySel, setDaySel] = useState(null)          // current day-grid slot {start,end} in HH:MM
  // Create UI is for signed-in editors only. Anonymous visitors browse a clean,
  // read-only calendar — the topbar "Sign in" is their single entry point, instead
  // of action buttons that turn out to demand an account after the tap.
  const canEdit = !!user && user.role !== 'viewer'
  const [moving, setMoving] = useState(null)
  const [scopeCancel, setScopeCancel] = useState(null)   // recurring cancel: pick this/following/series
  const today = startOfDay(new Date())
  // Calendar is public to view; any write action routes through this — anonymous → a
  // login sheet that RESUMES the action after sign-in (no redirect).
  const { requireLogin: requireAuth } = useAuthGate()
  const [confirm, confirmEl] = useConfirm()

  // SHY CHROME — scrolling the grid down hides the secondary rows (nav, filters)
  // so the hours get the space; scrolling up restores them.
  const [compact, setCompact] = useState(false)
  const lastY = useRef(null)
  const settling = useRef(true)
  useEffect(() => { lastY.current = null; setCompact(false) }, [view, cursor])

  // Toggling changes the grid window's height, so the browser re-clamps scrollTop
  // to keep it in range. At the BOTTOM of the day (midnight) collapsing the chrome
  // makes the window taller, which lowers max scroll, so scrollTop drops — which
  // looks exactly like "the user scrolled up". Reacting to it reopened the chrome,
  // which re-clamped, which reopened… the calendar bounced. So after every toggle
  // we ignore scroll until the transition settles, then re-baseline from wherever
  // we landed. Also covers the programmatic 8 AM jump on mount.
  useEffect(() => {
    settling.current = true
    const t = setTimeout(() => { settling.current = false }, 380)
    return () => clearTimeout(t)
  }, [compact])

  const onGridScroll = useCallback((y) => {
    // While settling, keep FOLLOWING the position but never act on it: the
    // baseline stays current, so the user's next real gesture is measured from
    // where the clamp left us — otherwise their first swipe is eaten setting it.
    if (settling.current) { lastY.current = y; return }
    if (lastY.current === null) { lastY.current = y; return }
    const dy = y - lastY.current
    if (Math.abs(dy) < 8) return                       // ignore jitter
    lastY.current = y
    setCompact(c => dy > 0 && y > 80 ? true : dy < 0 ? false : c)
  }, [])
  // month's scroll wrapper lives right here, so wire its native listener here too
  const monthWrapRef = useRef(null)
  useEffect(() => {
    const el = monthWrapRef.current
    if (!el) return
    const h = () => onGridScroll(el.scrollTop)
    el.addEventListener('scroll', h, { passive: true })
    return () => el.removeEventListener('scroll', h)
  }, [onGridScroll, view])

  // PULL-DOWN ANYWHERE brings the chrome back. Scrolling the grid up already
  // reveals it, but the pinned rows above the scroller (title, Week/Month, the
  // date strip) don't scroll — pulling down on them did nothing, which read as
  // "stuck". This is REVEAL-ONLY: it never hides, never preventDefaults (taps
  // and the horizontal week-swipe keep working), and skips touches that start
  // in the scroller — that one already speaks through its scroll events.
  const pageRef = useRef(null)
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    let start = null
    const ts = (e) => {
      start = e.target.closest('.v-gridwrap') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
    const tm = (e) => {
      if (!start) return
      const dx = e.touches[0].clientX - start.x
      const dy = e.touches[0].clientY - start.y
      // decisively downward — a sideways week-swipe (dx-dominant) must not fire it
      if (dy > 14 && dy > Math.abs(dx) * 1.2) { setCompact(false); start = null }
    }
    const te = () => { start = null }
    // desktop equivalent: wheel-up over the pinned rows
    const wh = (e) => { if (e.deltaY < -8 && !e.target.closest('.v-gridwrap')) setCompact(false) }
    el.addEventListener('touchstart', ts, { passive: true })
    el.addEventListener('touchmove', tm, { passive: true })
    el.addEventListener('touchend', te, { passive: true })
    el.addEventListener('wheel', wh, { passive: true })
    return () => {
      el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm)
      el.removeEventListener('touchend', te); el.removeEventListener('wheel', wh)
    }
  }, [])

  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), end: endOfDay(cursor) }
    // Week view is the FIXED calendar week (Mon…Sun) containing the cursor, so the
    // weekday columns hold their positions across navigation. Fetch that whole week.
    if (view === 'week') {
      const ws = startOfWeek(cursor, WEEK_OPTS)
      return { start: ws, end: addDays(ws, 7) }
    }
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    return { start: gridStart, end: addDays(gridStart, 42) }
  }, [view, cursor])

  const loadVenues = useCallback(() => {
    // Skip cancelled/rejected rows: they no longer hold the room, but they were
    // still filling this map, so an event whose venue had been removed stayed
    // filed (and colour-coded) under that room in the filter, and ticking
    // "Online / no room" wrongly hid it.
    api.get('/bookings').then(r => {
      const m = {}
      r.data.forEach(b => {
        if (b.event_id && !['cancelled', 'rejected'].includes(String(b.status))) m[b.event_id] = b.resource_name
      })
      setVenueByEvent(m)
    }).catch(() => {})
  }, [])
  // Swiping weeks quickly fires overlapping fetches, and whichever RESPONSE lands
  // last used to win — so a slow earlier week could overwrite the week now on screen.
  // WeekView then filters those blocks against the visible days, matches nothing, and
  // renders an empty grid that only a manual refresh fixes. A monotonic sequence
  // number makes stale responses no-ops.
  const loadSeq = useRef(0)
  const load = useCallback((silent = false) => {
    if (!silent) setEvents(null)   // background polls don't flash the skeleton
    const seq = ++loadSeq.current
    api.get('/events/calendar', { params: { start: range.start.toISOString(), end: range.end.toISOString() } })
      .then(r => {
        if (seq !== loadSeq.current) return      // a newer request has since gone out
        setEvents(r.data.map(e => ({ ...e, occurrenceDate: e.original_time || e.start })))
      })
      .catch(() => { if (seq === loadSeq.current) setEvents(prev => prev || []) })
  }, [range])
  // Fetch the real room list once — it's a few hundred bytes and rooms change
  // rarely, so this is far cheaper than the event fetch that already runs.
  useEffect(() => {
    // restore the saved SELECTION (empty = show all)
    const savedSel = readFiltersSel()
    setSelRooms(new Set(savedSel.rooms))
    setSelGroups(new Set(savedSel.groups))
    api.get('/resources').then(r => setRooms((r.data || []).filter(x => x.is_active !== false))).catch(() => {})
    api.get('/groups').then(r => setGroupList(r.data || [])).catch(() => {})
  }, [])
  // Write-through: persist the selection so it survives leaving the calendar.
  useEffect(() => {
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify({ rooms: [...selRooms], groups: [...selGroups] })) } catch {}
  }, [selRooms, selGroups])
  useEffect(() => { loadVenues() }, [loadVenues])
  useEffect(() => { load() }, [load])
  // Pick up other users' changes without a manual reload (poll + on-focus).
  useAutoRefresh(() => { load(true); loadVenues() }, 25000)

  // Deep link from a notification: /?event=<id> opens that event's detail sheet,
  // then strips the param so Back doesn't re-open it.
  useEffect(() => {
    const evId = sp.get('event')
    if (!evId) return
    let cancelled = false
    api.get(`/events/${evId}`)
      .then(r => { if (!cancelled) setSel({ ...r.data, blockStart: r.data.start_time, blockEnd: r.data.end_time, is_recurring: r.data.is_recurring_root }) })
      .catch(() => { if (!cancelled) snack('Event not found.') })
      .finally(() => {
        if (cancelled) return
        const next = new URLSearchParams(sp); next.delete('event'); setSp(next, { replace: true })
      })
    return () => { cancelled = true }
  }, [sp.get('event')]) // eslint-disable-line react-hooks/exhaustive-deps

  // The tab bar "+" (and the desktop sidebar "New event") ask for a create by
  // setting ?new=<ts>. It's handled HERE, not in the shell, because the create
  // flow needs the calendar's own view, cursor and any selected slot. The param
  // is stripped immediately so it fires exactly once. Replaces the old floating
  // FAB, which sat over the grid and hid a late-evening event on the last day.
  useEffect(() => {
    if (!sp.get('new')) return
    const next = new URLSearchParams(sp); next.delete('new'); setSp(next, { replace: true })
    if (!canEdit) return   // viewers can't create; guard even if the param appears
    requireAuth(() => {
      haptic()
      const base = { date: format(cursor, 'yyyy-MM-dd') }
      if (view !== 'day') { goDay(cursor); setCreate(base) }
      else setCreate(daySel ? { ...base, start: daySel.start, end: daySel.end } : base)
    })
  }, [sp.get('new')]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefer the room name the CALENDAR FEED now carries on every block. The old
  // venueByEvent map is built from /bookings, which returns only YOUR OWN bookings —
  // so a non-admin saw every colleague's event as "no room" and the room filter
  // silently skipped them. The map stays as a fallback for older cached responses.
  const eventVenue = (e) => (e.venues && e.venues[0]) || venueByEvent[e.id] || NO_ROOM
  const eventVenueName = (e) => (e.venues && e.venues[0]) || venueByEvent[e.id] || null
  // Colour identifies the COURSE first, then the kind. This used to read
  // `e.kind_color || ...`, so every event of kind "Class" drew the same colour and a
  // week of teaching was one flat hue. See eventColorFor in config.js for the order.
  const eventColor = (e) => eventColorFor(e, theme)
  // Empty selection = no filter = show all. With cohorts selected, an event passes
  // if ANY of its groups is selected (untagged events match the NO_GROUP row).
  const matchesGroup = (e) => {
    if (selGroups.size === 0) return true
    const gs = e.group_ids || []
    return gs.length === 0 ? selGroups.has(NO_GROUP) : gs.some(id => selGroups.has(id))
  }
  // An event in ANY selected room passes (an event can hold more than one room).
  const matchesRoom = (e) => {
    if (selRooms.size === 0) return true
    const names = (e.venues && e.venues.length) ? e.venues
      : (venueByEvent[e.id] ? [venueByEvent[e.id]] : [])
    return names.length === 0 ? selRooms.has(NO_ROOM) : names.some(n => selRooms.has(n))
  }
  const visible = (events || []).filter(e => matchesRoom(e) && matchesGroup(e))
  const toggleFilter = (key) => setSelRooms(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleGroupFilter = (id) => setSelGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openDetail = async (e) => {
    haptic()
    try {
      const r = await api.get(`/events/${e.id}`)
      // Seed title/kind from the OCCURRENCE (calendar block), not the series root:
      // a customised occurrence carries its own title/kind, and the editor must
      // show those — otherwise editing one field silently reverts the other to the
      // root's value. Fall back to the root detail when the block doesn't carry it.
      setSel({
        ...r.data,
        title: e.title != null ? e.title : r.data.title,
        event_kind_id: e.event_kind_id !== undefined ? e.event_kind_id : r.data.event_kind_id,
        blockStart: e.start, blockEnd: e.end,
        is_recurring: e.is_recurring, is_exception: e.is_exception, occurrenceDate: e.occurrenceDate,
        // Carry the BLOCK's own venue through. An occurrence moved to its own room
        // holds it on its exception booking, which /events/{id} (the series root)
        // knows nothing about — so without these the edit sheet highlighted the
        // SERIES room. Worse, `baseline.roomId` was seeded from that same wrong
        // value, so tapping the room the occurrence is actually in read as "no
        // change" and the save silently dropped it.
        venues: e.venues, venue_ids: e.venue_ids,
      })
    } catch { setSel({ ...e, blockStart: e.start, blockEnd: e.end }) }
  }
  const cancelEvt = async () => {
    // Repeating event → ask the same this/following/series question as edit does,
    // so a cancel can't wipe a whole timetable by accident either.
    if (sel.is_recurring) {
      // opened from a notification (no day known) → go pick the occurrence first
      if (!sel.occurrenceDate) {
        setSel(null); go('week', today, true)
        snack('Pick a day, then the event.')
        return
      }
      setScopeCancel({ id: sel.id, title: sel.title, occurrenceDate: sel.occurrenceDate })
      setSel(null)
      return
    }
    const ok = await confirm({ title: 'Cancel this event?', body: `Removes “${sel.title}”. Tagged people are notified.`, confirmLabel: 'Cancel event', cancelLabel: 'Keep it', danger: true })
    if (!ok) return
    try { await api.post(`/events/${sel.id}/cancel`, {}); snack('Cancelled'); setSel(null); load() }
    catch (e) { snack(errText(e, 'Failed')) }
  }
  // Guards a double-tap: the scope sheet stays mounted for the whole round trip, so
  // two taps sent two cancels — the first succeeded, the second hit an
  // already-cancelled series, and its error snack replaced the success one. The user
  // was told a cancel that worked had failed.
  const cancelInFlight = useRef(false)
  const doCancelScope = async (scope) => {
    if (cancelInFlight.current) return
    cancelInFlight.current = true
    const t = scopeCancel
    const body = { scope }
    if (scope === 'occurrence' || scope === 'following') body.occurrence_date = t.occurrenceDate
    try {
      await api.post(`/events/${t.id}/cancel`, body)
      snack(scope === 'series' ? 'Series cancelled' : 'Cancelled')
      setScopeCancel(null); load()
    } catch (e) { snack(errText(e, 'Failed')) }
    finally { cancelInFlight.current = false }
  }

  const goDay = (d) => go('day', startOfDay(d), true)
  // Back from Day view = real history back, so you land on whichever view
  // (week or month, at whatever date) you tapped the day from.
  const backFromDay = () => { if (location.key !== 'default') navigate(-1); else go('week', cursor) }
  const stepBack = () => setCursor(c => view === 'day' ? addDays(c, -1) : view === 'week' ? addWeeks(c, -1) : addMonths(c, -1))
  const stepFwd = () => setCursor(c => view === 'day' ? addDays(c, 1) : view === 'week' ? addWeeks(c, 1) : addMonths(c, 1))
  const title = view === 'day' ? format(cursor, 'EEEE, MMM d') : format(cursor, 'MMMM yyyy')
  // Only offer "Go to today" when today ISN'T already on screen — week view shows the
  // fixed Mon–Sun week containing the cursor, month view is the cursor's month.
  // (This is only read in week/month; day view has its own indicator.)
  const todayOnScreen = view === 'month'
    ? cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear()
    : isSameWeek(today, cursor, WEEK_OPTS)

  // ── Filters live behind ONE button in the nav row (opens a sheet), not in
  // chip rows on the page — that's ~50–100px given back to the grid. So a hidden
  // filter is never silent, the button wears a dot whenever a filter is applied.
  const [filterOpen, setFilterOpen] = useState(false)
  // Which filter category the rail has selected. Unlike the accordion this replaced,
  // exactly one is always active — a rail with nothing chosen shows an empty right
  // pane, which reads as "no filters exist".
  const [filterSectionRaw, setFilterSection] = useState('groups')
  const filterActive = selGroups.size > 0 || selRooms.size > 0
  // Never leave the rail pointing at a category that has nothing in it — on a fresh
  // database there are no groups yet, and the right pane would open blank.
  const filterSection = (filterSectionRaw === 'groups' && groupList.length === 0) ? 'rooms'
    : (filterSectionRaw === 'rooms' && rooms.length === 0) ? 'groups'
      : filterSectionRaw
  // "All cohorts"/"All rooms" is the empty state (nothing narrowed). Tapping it
  // clears that section back to showing everything.
  const allGroups = selGroups.size === 0
  const allRooms = selRooms.size === 0

  return (
    <div className="v-calpage" ref={pageRef}>
      {view !== 'day' && (
        <>
          <div className="v-cal-head">
            {/* The month/year title doubles as a jump-to-any-date control, so you
                never have to step week-by-week to reach a far-off date. */}
            <label className="v-cal-title v-cal-title--jump">
              {title}
              <input type="date" aria-label="Jump to a date"
                value={format(cursor, 'yyyy-MM-dd')}
                // Same guard as DateJump.jsx: a native date field accepts years past
                // 9999, parseISO returns Invalid Date for those, and an invalid
                // `cursor` makes the format() on the line above throw during the NEXT
                // render — which unmounts the tree and blanks the page. Drop the pick.
                onChange={(e) => {
                  if (!e.target.value) return
                  const picked = startOfDay(parseISO(`${e.target.value}T00:00`))
                  if (!Number.isNaN(picked.getTime())) setCursor(picked)
                }} />
            </label>
            <div className="v-seg">
              <button className={view === 'week' ? 'v-seg--active' : ''} onClick={() => setView('week')}>Week</button>
              <button className={view === 'month' ? 'v-seg--active' : ''} onClick={() => setView('month')}>Month</button>
            </div>
          </div>

          {/* Everything below the title is SHY — it tucks away while you scroll the
              grid down and comes back the moment you scroll up. The filter chip
              rows that used to sit here moved into the funnel's sheet. */}
          <div style={shyStyle(compact)}>
            {/* padding-top: the count badge rides 6px above the funnel button, and
                this shy wrapper clips overflow — without headroom the badge's top
                gets shaved off. Same reason the right pair's gap is 10px: the
                badge protrudes 6px toward the › arrow and needs to clear it. */}
            <div className="v-navrow" style={{ justifyContent: 'space-between', marginBottom: 12, paddingTop: 6 }}>
              <button className="v-iconbtn" onClick={stepBack} aria-label="Previous"><ChevronLeft size={18} /></button>
              {todayOnScreen
                ? <span className="m-muted" style={{ fontSize: '0.82rem' }}>{view === 'month' ? 'This month' : 'This week'}</span>
                : <button className="m-chip m-chip--today" onClick={() => { haptic(); setCursor(today) }}><span className="m-chip__pre">Go to</span>TODAY</button>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className={`v-iconbtn v-filterbtn ${filterActive ? 'v-filterbtn--on' : ''}`}
                  onClick={() => { haptic(); setFilterOpen(true) }} aria-label={filterActive ? 'Filters (active)' : 'Filters'}>
                  <Filter size={17} />
                  {filterActive && <span className="v-filterdot" />}
                </button>
                <button className="v-iconbtn" onClick={stepFwd} aria-label="Next"><ChevronRight size={18} /></button>
              </div>
            </div>
          </div>
        </>
      )}

      {view === 'month' && <div className="v-gridwrap" ref={monthWrapRef}><MonthView cursor={cursor} today={today} events={visible} eventColor={eventColor} onPick={goDay} /></div>}
      {view === 'week' && <WeekView cursor={cursor} today={today} events={visible} eventColor={eventColor} loading={events === null} onPickDay={goDay} onEvent={openDetail} onPrev={stepBack} onNext={stepFwd} onGridScroll={onGridScroll} />}
      {view === 'day' && <DayView cursor={cursor} today={today} events={visible} eventColor={eventColor} loading={events === null} onBack={backFromDay} creating={!!create}
        onPrev={stepBack} onNext={stepFwd} onToday={() => setCursor(today)} onSelect={setDaySel}
        onEvent={openDetail}
        filterActive={filterActive} onOpenFilter={() => { haptic(); setFilterOpen(true) }}
        onCreate={canEdit ? (start, end) => requireAuth(() => setCreate({ date: format(cursor, 'yyyy-MM-dd'), start, end })) : null} />}

      {/* The old floating "+" FAB was removed 2026-07-23 — it hid bottom-right
          events. Creating now runs from the tab-bar centre "+" (and the desktop
          sidebar button) via the ?new handler above; on the day grid you can also
          tap a slot and use the selection bar's "Add event". */}

      <CreateEventV3 open={!!create} onClose={() => setCreate(null)} date={create?.date} start={create?.start} end={create?.end}
        prefill={create?.prefill} requestFor={create?.requestFor}
        onCreated={() => { setCreate(null); load(); loadVenues() }} />

      <SheetV3 open={!!sel} onClose={() => setSel(null)} title={sel?.title}>
        {sel && (() => {
          const canAct = (user?.role === 'admin' || sel.is_mine) && sel.status !== 'cancelled'
          // "I want THAT slot" — the second door into the request flow. Editors only,
          // not the holder (they edit instead), not admins (they act directly), and
          // only for future slots that actually reserve a room.
          const canRequest = user && user.role !== 'viewer' && !canAct
            && sel.status !== 'cancelled' && (sel.bookings || [])[0]?.resource_id
            && parseISO(sel.blockStart || sel.start_time) > new Date()
          // Seed the create sheet with the tapped slot (snapped to the pickers'
          // 30-min steps: start floors, end ceils, so the window always covers it).
          const requestSlot = () => {
            const s = parseISO(sel.blockStart || sel.start_time)
            const e = parseISO(sel.blockEnd || sel.end_time)
            s.setMinutes(s.getMinutes() >= 30 ? 30 : 0, 0, 0)
            if (e.getMinutes() > 30) e.setHours(e.getHours() + 1, 0, 0, 0)
            else if (e.getMinutes() > 0) e.setMinutes(30, 0, 0)
            haptic()
            setCreate({
              date: format(s, 'yyyy-MM-dd'), start: format(s, 'HH:mm'), end: format(e, 'HH:mm'),
              prefill: { resource_id: sel.bookings[0].resource_id },
              // context for the sheet's header banner — without it you land in a
              // blank "New event" form with no idea why you're filling it in
              requestFor: {
                holder: sel.organizer_name,
                room: sel.bookings[0].resource_name,
                event: sel.title,
                when: `${format(parseISO(sel.blockStart || sel.start_time), 'EEE MMM d · h:mm a')}–${format(parseISO(sel.blockEnd || sel.end_time), 'h:mm a')}`,
              },
            })
            setSel(null)
          }
          return (
            <div>
              {/* Kind sits directly under the title as a SIGNIFIER, not a labelled row —
                  "Seminar" says what this is at a glance and needs no "Kind:" in front
                  of it. Coloured from the same palette the calendar block uses, so the
                  chip and the block you tapped are visibly the same thing. */}
              {sel.kind_name && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '-4px 0 12px' }}>
                  <span className="m-badge" style={{
                    background: eventColor(sel), color: readableOn(eventColor(sel)),
                    fontWeight: 700, letterSpacing: '.01em',
                  }}>{sel.kind_name}</span>
                </div>
              )}
              {/* The Status row is gone. It read the EVENT status, which is only ever
                  draft/confirmed/cancelled — nothing creates drafts and the calendar
                  filters out cancelled, so from the grid it said "confirmed" every
                  single time. Worse, it was easy to read as "your room is confirmed",
                  which it never meant: the room lives on a BOOKING with its own status,
                  and that can be pending while this said confirmed.
                  It is replaced by a banner that appears ONLY when it has something to
                  say — a cancelled event is still reachable by notification deep-link
                  (/?event=<id>), which bypasses the calendar's filter, and dropping the
                  row outright would have left that screen with no sign it was cancelled. */}
              {String(sel.status).toLowerCase() === 'cancelled' && (
                <div className="m-warn" style={{ marginBottom: 12, fontSize: '0.86rem' }}>
                  <strong>Cancelled.</strong> This event is no longer on the calendar.
                </div>
              )}
              {sel.description && <p className="m-muted" style={{ marginTop: 0 }}>{sel.description}</p>}
              {/* Start and End were two rows saying one thing. One range reads faster and
                  drops the repeated date. */}
              <DetailRow label="When" value={`${format(parseISO(sel.blockStart || sel.start_time), 'EEE MMM d · h:mm a')} – ${format(parseISO(sel.blockEnd || sel.end_time), 'h:mm a')}`} />
              {/* Only bookings that still HOLD the room. Clearing a venue cancels the
                  booking rather than deleting it (notifications FK it), and the detail
                  endpoint returns every row regardless of status — so a room you had
                  released still showed here as the venue while the calendar block,
                  which does filter, correctly showed none. */}
              {(() => {
                const held = (sel.bookings || []).filter(b => !['cancelled', 'rejected'].includes(String(b.status)))
                return held.length > 0
                  ? <DetailRow label="Venue" value={held.map(b => b.resource_name).filter(Boolean).join(', ')} />
                  : null
              })()}
              {(sel.group_names || []).length > 0 && <DetailRow label="For" value={sel.group_names.join(', ')} />}
              {/* Organiser last: it is the least-asked question on this sheet — you open
                  an event to see when and where, and whose it is only afterwards. */}
              {sel.organizer_name && <DetailRow label="Organizer" value={sel.organizer_name} />}
              <Btn full variant="ghost" style={{ marginTop: 14 }} onClick={() => {
                const how = addToCalendar({
                  id: sel.id, title: sel.title, description: sel.description,
                  start: sel.blockStart || sel.start_time, end: sel.blockEnd || sel.end_time,
                  location: (sel.bookings || []).map(b => b.resource_name).filter(Boolean).join(', '),
                })
                snack(how === 'android' ? 'Opening calendar…' : 'File saved. Open to add.')
              }}><CalendarPlus size={16} /> Add to calendar</Btn>
              {canRequest && (
                <Btn variant="primary" full style={{ marginTop: 10 }} onClick={requestSlot}>
                  <ArrowLeftRight size={16} /> Request this slot
                </Btn>
              )}
              {canAct && (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginTop: 14 }}>
                  <Btn variant="primary" full onClick={() => {
                    // Opened from a notification (no specific day known): send them
                    // to the calendar to tap the exact occurrence, where all three
                    // scopes then apply — rather than edit blind against the series.
                    if (sel.is_recurring && !sel.occurrenceDate) {
                      setSel(null); go('week', today, true)
                      snack('Pick a day, then the event.')
                      return
                    }
                    setMoving(sel); setSel(null)
                  }}>Edit event</Btn>
                  <Btn full variant="ghost" style={{ color: 'var(--danger)' }} onClick={cancelEvt}>{sel.is_recurring ? 'Cancel…' : 'Cancel event'}</Btn>
                </div>
              )}
            </div>
          )
        })()}
      </SheetV3>

      <EditSheet event={moving} onClose={() => setMoving(null)} onDone={() => { setMoving(null); load(); loadVenues() }} snack={snack} />

      {/* Cancelling a repeating event asks the same this/following/series question. */}
      <RecurringScopeSheet open={!!scopeCancel} action="cancel"
        title={scopeCancel?.title || ''}
        hasOccurrence={!!scopeCancel?.occurrenceDate}
        when={scopeCancel?.occurrenceDate ? format(parseISO(scopeCancel.occurrenceDate), 'EEE, MMM d') : ''}
        onClose={() => setScopeCancel(null)} onPick={doCancelScope} />

      {/* Filter sheet — Google-style checklist rows (colour dot · name · check).
          Plain buttons, so it behaves identically on every OS. Rooms are
          filterable from every view here (the old chips only offered them on
          month, though the filter applied everywhere). */}
      {/* TWO PANES — categories on the left, that category's options on the right,
          the way Ajio/Flipkart/Myntra do it on a phone.

          I argued against this earlier on width grounds and I was wrong: I assumed the
          long values ("ZZREC Room Approval") would sit in the rail. They don't — the
          rail holds only CATEGORY names, which are short ("Groups", "Rooms"), so 30%
          is plenty for it and the values still get ~70% on the right.

          The rail also solves something the accordion couldn't: each category carries
          its own selected-count, so you can see you have 2 rooms picked while you are
          standing in Groups. With stacked sections that count was only visible if the
          section happened to be on screen. */}
      <SheetV3 open={filterOpen} onClose={() => setFilterOpen(false)} title="Filters">
        {groupList.length === 0 && rooms.length === 0 ? (
          <p className="m-muted">Nothing to filter yet.</p>
        ) : (
          <div className="v-fpanes">
            <div className="v-frail">
              {groupList.length > 0 && (
                <button type="button" className={`v-frail__cat ${filterSection === 'groups' ? 'is-on' : ''}`}
                  onClick={() => { haptic(); setFilterSection('groups') }}>
                  <span>Groups</span>
                  {selGroups.size > 0 && <span className="v-frail__n">{selGroups.size}</span>}
                </button>
              )}
              {rooms.length > 0 && (
                <button type="button" className={`v-frail__cat ${filterSection === 'rooms' ? 'is-on' : ''}`}
                  onClick={() => { haptic(); setFilterSection('rooms') }}>
                  <span>Rooms</span>
                  {selRooms.size > 0 && <span className="v-frail__n">{selRooms.size}</span>}
                </button>
              )}
            </div>
            <div className="v-fopts">
              {filterSection === 'groups' && groupList.length > 0 && (<>
                {/* "All groups" is the cleared state — tap it to stop narrowing. Labelled
                    "Groups" to match the rest of the app (create form, nav, Groups screen);
                    "Cohorts" here was the lone deviation and users couldn't map the two. */}
                <FilterRow allRow label="All groups" on={allGroups} onTap={() => setSelGroups(new Set())} />
                {groupList.map((g, gi) => (
                  <FilterRow key={g.id} color={GROUP_TAG_COLORS[gi % GROUP_TAG_COLORS.length]} label={g.name}
                    on={selGroups.has(g.id)} onTap={() => toggleGroupFilter(g.id)} />
                ))}
                <FilterRow color="var(--text-3)" label="No group"
                  on={selGroups.has(NO_GROUP)} onTap={() => toggleGroupFilter(NO_GROUP)} />
              </>)}
              {filterSection === 'rooms' && rooms.length > 0 && (<>
                <FilterRow allRow label="All rooms" on={allRooms} onTap={() => setSelRooms(new Set())} />
                {rooms.map(r => (
                  <FilterRow key={r.id} color={venueColorForName(r.name, theme)} label={r.name}
                    on={selRooms.has(r.name)} onTap={() => toggleFilter(r.name)} />
                ))}
                <FilterRow color={venueColorForName(null, theme)} label="No room"
                  on={selRooms.has(NO_ROOM)} onTap={() => toggleFilter(NO_ROOM)} />
              </>)}
            </div>
          </div>
        )}
        {/* "Done" is gone. Filters apply the moment you tap one (toggleFilter sets state
            directly), so it only ever closed the sheet — which a backdrop tap and a
            swipe-down already do. Clear all replaces it, and only appears when there is
            something to clear, so the bottom of the sheet is empty in the common case
            instead of carrying a button that does nothing. */}
        {filterActive && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginTop: 14 }}>
            <Btn full variant="ghost" onClick={() => { haptic(); setSelRooms(new Set()); setSelGroups(new Set()) }}>
              Clear all
            </Btn>
          </div>
        )}
      </SheetV3>
      {confirmEl}
    </div>
  )
}

// One tappable row in the filter sheet: colour dot · name · check (or an empty
// box when off). Full-width 48px targets, no native checkbox styling to vary
// between platforms. `allRow` is the section's "All …" header — no colour dot,
// bold — which reads as selected when nothing specific is narrowed.
function FilterRow({ color, label, on, onTap, allRow }) {
  return (
    <button type="button" className={`v-frow ${on ? '' : 'v-frow--off'} ${allRow ? 'v-frow--all' : ''}`} role="checkbox" aria-checked={on}
      onClick={() => { haptic(); onTap() }}>
      {allRow ? <span className="v-frow__dot v-frow__dot--none" /> : <span className="v-frow__dot" style={{ background: color }} />}
      <span className="v-frow__label">{label}</span>
      {on ? <Check size={18} style={{ color: 'var(--brand)', flex: '0 0 auto' }} /> : <span className="v-frow__box" />}
    </button>
  )
}

function MonthView({ cursor, today, events, eventColor, onPick }) {
  const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const byDay = {}
  events.forEach(e => { const k = format(parseISO(e.start), 'yyyy-MM-dd'); (byDay[k] = byDay[k] || []).push(e) })
  return (
    <div>
      <div className="v-month__dow">{DOW.map(d => <span key={d}>{d[0]}</span>)}</div>
      <div className="v-month__grid">
        {cells.map(d => {
          const k = format(d, 'yyyy-MM-dd'); const list = byDay[k] || []
          return (
            <button key={k} className={`v-daycell ${!isSameMonth(d, cursor) ? 'v-daycell--outside' : ''} ${isSameDay(d, today) ? 'v-daycell--today' : ''}`} onClick={() => { haptic(); onPick(d) }}>
              <span className="v-daynum">{format(d, 'd')}</span>
              {/* Cap dots at 4 but show "+N" when there are more, so a busy day doesn't
                  silently look identical to a 4-event day. */}
              <span className="v-daydots">
                {list.slice(0, 4).map((e, i) => <i key={i} style={{ background: eventColor(e) }} />)}
                {list.length > 4 && (
                  <em style={{ fontSize: '0.58rem', fontStyle: 'normal', color: 'var(--text-3)', marginLeft: 2, lineHeight: 1, alignSelf: 'center' }}>+{list.length - 4}</em>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ cursor, today, events, eventColor, loading, onPickDay, onEvent, onPrev, onNext, onGridScroll }) {
  // FIXED Mon…Sun week containing the cursor — the same weekday always sits in the
  // same column, so paging weeks changes only the date numbers, not the layout.
  const weekStart = startOfWeek(cursor, WEEK_OPTS)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i)
  const sx = useRef(null)
  const swiped = useRef(false)   // suppress the tap that follows a swipe
  const gridRef = useRef(null)
  const wrapRef = useRef(null)
  // Native listener, NOT React's onScroll: React delegates scroll at its root and
  // the event never arrived there for this nested scroller — the shy chrome
  // simply didn't react. Listening on the element itself always fires.
  useEffect(() => {
    const el = wrapRef.current
    if (!el || !onGridScroll) return
    const h = () => onGridScroll(el.scrollTop)
    el.addEventListener('scroll', h, { passive: true })
    return () => el.removeEventListener('scroll', h)
  }, [onGridScroll])
  // open the week scrolled to 8 AM (the 24h grid otherwise starts at midnight)
  useEffect(() => { scrollToHour(gridRef.current, 8, WK_PX) }, [cursor]) // eslint-disable-line
  const onTS = (e) => { sx.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; swiped.current = false }
  const onTE = (e) => {
    if (!sx.current) return
    const dx = e.changedTouches[0].clientX - sx.current.x
    const dy = e.changedTouches[0].clientY - sx.current.y
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { swiped.current = true; haptic(); dx > 0 ? onPrev() : onNext() }
    sx.current = null
  }
  const pick = (d) => { if (!swiped.current) onPickDay(d) }
  return (
    // fills the calendar page; the date row stays put while the grid scrolls below it
    <div onTouchStart={onTS} onTouchEnd={onTE} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="v-week__head">
        <div className="v-week__gutter" />
        {days.map(d => (
          <button key={d.toISOString()} className={`v-week__dayhd ${isSameDay(d, today) ? 'v-week__dayhd--today' : ''}`} onClick={() => { haptic(); pick(d) }}>
            <span className="v-week__dow">{format(d, 'EEE')}</span>
            <span className="v-week__num">{format(d, 'd')}</span>
          </button>
        ))}
      </div>
      <div className="v-gridwrap" ref={wrapRef}>
      <div className="v-week__grid" ref={gridRef} style={{ height: (DAY_END - DAY_START) * WK_PX }}>
        <div className="v-week__gutter">
          {hours.map(h => <div key={h} className="v-week__hlabel" style={{ height: WK_PX }}>{format(new Date().setHours(h, 0), 'ha')}</div>)}
        </div>
        {days.map((d, di) => {
          const list = events.filter(e => isSameDay(parseISO(e.start), d))
          return (
            <div key={di} className="v-week__col" onClick={() => pick(d)} style={{ height: (DAY_END - DAY_START) * WK_PX }}>
              {hours.map(h => <div key={h} className="v-week__line" style={{ top: (h - DAY_START) * WK_PX }} />)}
              {/* Cascade, not lanes — see stackOverlaps. Overlapping blocks used to be
                  drawn at identical left/width, so only the last one painted was
                  visible and a clash looked like a single event. */}
              {stackOverlaps(list).map(({ e, depth, over, front }) => {
                const s = parseISO(e.start), en = parseISO(e.end)
                const { top, height: h, clipped } = clampBand(s, en, WK_PX, 16)
                const bg = eventColor(e)
                // OPTION A — tinted block, not a filled one. A pale wash of the course
                // hue with a solid bar of the full hue on the left edge. Sixteen courses
                // stay sixteen distinguishable things while the grid stops shouting.
                // color-mix does the theme work: 14% of the hue into --surface is pale on
                // white and deep-muted on #131316, so ONE rule serves both themes and the
                // label is always var(--text). That also ends the old flicker where some
                // blocks carried white labels and others dark ones, purely because the
                // fills differed so much in lightness.
                const fill = `color-mix(in srgb, ${bg} 14%, var(--surface))`
                const hasMore = front && over > 0 && h >= 18  // this block owns the "+N"
                return (
                  <div key={e.id + e.start} className={`v-week__ev ${depth > 0 ? 'v-week__ev--stacked' : ''}`}
                    style={{ top, height: h, left: 1 + depth * WK_CASCADE_PX, zIndex: 2 + depth,
                      background: fill, borderLeft: `3px solid ${bg}`, color: 'var(--text)' }}
                    onClick={(ev) => { ev.stopPropagation(); onEvent(e) }}
                    title={clipped ? `${e.title} — ${format(s, 'h:mm a')}–${format(en, 'h:mm a')} (outside 8 AM–9 PM)` : e.title}>
                    {h > 10 && <span className="v-week__ev-title">{e.title}</span>}
                    {/* No start time on a badged block: measured, the "+N" pill landed
                        13px on top of it. A cascaded block is down to ~33px of width, so
                        one of the two has to go — and in a time grid the start time is
                        already given by vertical position, whereas "+2" is derivable
                        from nothing on screen. */}
                    {h > 30 && !hasMore && <span className="v-week__ev-time">{format(s, 'h:mm')}</span>}
                    {/* The blocks underneath are only tappable on a 5px sliver, which is
                        no tap target — so the badge is the way through. It opens the DAY
                        view for that date, which already lays overlaps out side by side
                        at a width where they can be read. Only the front block shows it,
                        otherwise a stack of three would wear three badges. */}
                    {hasMore && (
                      <button type="button" className="v-week__more"
                        onClick={(ev) => { ev.stopPropagation(); haptic(); onPickDay(d) }}
                        title={`${over} more at this time — open the day`}
                        aria-label={`${over} more events at this time. Open ${format(d, 'EEEE d MMMM')}.`}>
                        +{over}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {loading && <span className="m-spin" style={{ position: 'absolute', right: 6, top: 6 }} />}
      </div>
      </div>
    </div>
  )
}

function DayView({ cursor, today, events, eventColor, loading, onBack, onPrev, onNext, onToday, creating, onEvent, onCreate, onSelect, filterActive, onOpenFilter }) {
  const isToday = isSameDay(cursor, today)
  return (
    // Back/Today and the date stepper stay pinned; the 24h grid scrolls below them
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Row 1 — clearly-labelled Back (returns to week/month) + Today */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button className="v-iconbtn" style={{ width: 'auto', padding: '0 12px', gap: 6 }} onClick={() => { haptic(); onBack() }} aria-label="Back to calendar">
          <ChevronLeft size={18} /><span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Back</span>
        </button>
        <div style={{ flex: 1 }} />
        {loading && <span className="m-spin" />}
        {/* neutral chip — amber is reserved for "now", not for controls (see v3.css) */}
        {!isToday && <button className="m-chip m-chip--today" onClick={() => { haptic(); onToday() }}><span className="m-chip__pre">Go to</span>TODAY</button>}
        {/* Same filter funnel as week/month view. Without it, a filter set elsewhere
            silently hides events here with no cue or way to clear it — a "where did my
            event go?" trap. The active dot makes the cause discoverable. */}
        {onOpenFilter && (
          <button className={`v-iconbtn v-filterbtn ${filterActive ? 'v-filterbtn--on' : ''}`}
            onClick={onOpenFilter} aria-label={filterActive ? 'Filters (active)' : 'Filters'}>
            <Filter size={17} />
            {filterActive && <span className="v-filterdot" />}
          </button>
        )}
      </div>

      {/* Row 2 — day stepper: prev / next flank the date. Ordinal + month so it's
          unmistakably "5th July, Friday", not a bare "5". */}
      <div className="v-dayhead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
        <button className="v-iconbtn" onClick={() => { haptic(); onPrev() }} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <div style={{ textAlign: 'center', minWidth: 0 }}>
          <span className={`v-dayhead__num ${isToday ? 'v-dayhead__num--today' : ''}`} style={{ fontSize: '1.2rem' }}>{format(cursor, 'do')}</span>
          <span style={{ fontWeight: 600, marginLeft: 6 }}>{format(cursor, 'MMMM')}</span>
          <span className="m-muted" style={{ marginLeft: 6 }}>{format(cursor, 'EEEE')}</span>
        </div>
        <button className="v-iconbtn" onClick={() => { haptic(); onNext() }} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      {/* DayGrid owns its scroller now, so its confirm bar can sit below the grid */}
      <DayGrid cursor={cursor} today={today} events={events} eventColor={eventColor}
        confirmLabel="Add event" sheetOpen={creating} onEventTap={onEvent} onSelect={onSelect}
        onConfirm={onCreate ? (s, e) => onCreate(s, e) : null} />
    </div>
  )
}

function EditSheet({ event, onClose, onDone, snack }) {
  const [theme] = useTheme()   // venue dots differ per theme (see config.js)
  const [title, setTitle] = useState('')
  const [kinds, setKinds] = useState([])
  const [kindId, setKindId] = useState(null)
  const [date, setDate] = useState('')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [venues, setVenues] = useState(null)
  const [sent, setSent] = useState({})
  const [sending, setSending] = useState(null)
  const [picking, setPicking] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  // ── room / groups / visibility (added 2026-07-26) ──
  // `roomId` is a resource id, or ROOM_NONE for "no room / not decided yet".
  // `baseline` remembers what the event started with so we only send what changed.
  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState(ROOM_NONE)
  // `touched` = the user has already chosen a room/cohort/visibility/organizer, so the
  // in-flight detail fetch must NOT overwrite them. `cancelDetail` lets a reopen
  // invalidate the previous event's fetch.
  const touched = useRef(false)
  const cancelDetail = useRef(null)
  const [allGroups, setAllGroups] = useState([])
  const [groupIds, setGroupIds] = useState([])
  const [isPublic, setIsPublic] = useState(true)
  // Organizer reassignment is ADMIN-only (the API enforces it too).
  const [people, setPeople] = useState([])
  const [organizerId, setOrganizerId] = useState('')
  const [baseline, setBaseline] = useState({ roomId: ROOM_NONE, groupIds: [], isPublic: true, organizerId: '' })
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    if (event) {
      setTitle(event.title || '')
      setKindId(event.event_kind_id || null)
      setPicking(false)
      setDate(format(parseISO(event.blockStart || event.start_time), 'yyyy-MM-dd'))
      setStart(format(parseISO(event.blockStart || event.start_time), 'HH:mm'))
      setEnd(format(parseISO(event.blockEnd || event.end_time), 'HH:mm'))
      setError(''); setVenues(null); setSent({}); setSending(null); setScopeOpen(false)
      touched.current = false
      api.get('/event-kinds').then(r => setKinds(r.data)).catch(() => {})
      api.get('/resources').then(r => setRooms((r.data || []).filter(x => x.is_active !== false))).catch(() => {})
      api.get('/groups').then(r => setAllGroups(r.data || [])).catch(() => {})
      // Seed from the calendar block, then confirm against the event detail (the
      // block carries venue NAMES; the detail carries the resource IDS we must send).
      const seedGroups = event.group_ids || []
      const seedPublic = event.is_public !== false
      const seedOrg = event.organizer_id || ''
      setGroupIds(seedGroups); setIsPublic(seedPublic); setOrganizerId(seedOrg)
      setRoomId(ROOM_NONE)
      setBaseline({ roomId: ROOM_NONE, groupIds: seedGroups, isPublic: seedPublic, organizerId: seedOrg })
      if (user?.role === 'admin') {
        api.get('/users').then(r => setPeople((r.data || []).filter(u => u.is_active !== false && u.role !== 'viewer'))).catch(() => {})
      }
      // The clicked BLOCK already knows this occurrence's own room (an occurrence can
      // have been moved to a different room than the rest of the series), so prefer
      // it; the detail endpoint only knows the series-level booking.
      const blockRoom = (event.venue_ids && event.venue_ids[0]) || null
      if (blockRoom || (event.venues && event.venues.length === 0)) {
        const seed = blockRoom || ROOM_NONE
        setRoomId(seed)
        setBaseline(b => ({ ...b, roomId: seed }))
      }
      // The sheet is interactive from its first paint, so this response can land
      // AFTER the user has already picked a room / cohort / visibility — and it used
      // to overwrite those picks with the stored values, silently. Worse, it also
      // reset `baseline`, so the save diff then saw "nothing changed" and the tap was
      // lost with a success message. `stale` also covers reopening the sheet on a
      // different event before the previous fetch resolves.
      let stale = false
      cancelDetail.current = () => { stale = true }
      api.get(`/events/${event.id}`).then(r => {
        if (stale || touched.current) return
        const d = r.data || {}
        const active = (d.bookings || []).filter(b => !['cancelled', 'rejected'].includes(String(b.status || '').toLowerCase()))
        const rid = blockRoom || (event.venues && event.venues.length === 0 ? ROOM_NONE
                                  : (active[0]?.resource_id || ROOM_NONE))
        const gids = d.group_ids || seedGroups
        const pub = d.is_public !== false
        const org = d.organizer_id || seedOrg
        setRoomId(rid); setGroupIds(gids); setIsPublic(pub); setOrganizerId(org)
        setBaseline({ roomId: rid, groupIds: gids, isPublic: pub, organizerId: org })
      }).catch(() => {})
      return () => { stale = true }
    }
  }, [event])
  if (!event) return null

  // Room, groups and visibility belong to the WHOLE series (the room is the series'
  // template booking; the tags and the public flag live on the root), so there is no
  // per-occurrence version of them.
  const roomChanged = roomId !== baseline.roomId
  const groupsChanged = !sameSet(groupIds, baseline.groupIds)
  const publicChanged = isPublic !== baseline.isPublic
  const organizerChanged = isAdmin && !!organizerId && organizerId !== baseline.organizerId
  // The ROOM is no longer series-wide: one occurrence can be moved to its own room
  // (it carries its own booking), so a room change may be scoped like a time change.
  // Groups / visibility / owner still live on the series root and cannot be per-date.
  const seriesWideChanged = groupsChanged || publicChanged || organizerChanged
  // Name the fields that are actually about to go series-wide, for the notice below.
  // Built from the same three flags the save path uses, so the two can't disagree.
  const wideList = (() => {
    const f = [groupsChanged && 'groups', publicChanged && 'visibility', organizerChanged && 'owner'].filter(Boolean)
    return f.length < 2 ? (f[0] || '') : `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`
  })()
  // Hoisted so save() can tell whether there is anything SCOPE-DEPENDENT to ask
  // about. Previously these lived inside doSave, so a series-wide edit skipped the
  // scope sheet and silently applied the user's TIME change to the whole series.
  // `date` is '' until the open-effect fills it, so these run once with no date.
  // Guard rather than compute — this is evaluated during render.
  const nsNow = toISO(date, start), neNow = toISO(date, end)
  const timeChanged = !!nsNow && !!neNow && (
    !event.blockStart
    || +parseISO(nsNow) !== +parseISO(event.blockStart)
    || +parseISO(neNow) !== +parseISO(event.blockEnd))
  const titleChanged = title.trim() !== (event.title || '').trim()
  const kindChanged = (kindId || null) !== (event.event_kind_id || null)
  const scopedChanged = timeChanged || titleChanged || kindChanged || roomChanged

  // A repeating event never edits silently: pick a scope first (this one / this
  // and following / whole series). A one-off saves straight away.
  const save = () => {
    if (!title.trim()) { setError('Title cannot be empty.'); return }
    if (end <= start) { setError('End must be after start.'); return }
    if (event.is_recurring) {
      // Series-wide fields (groups/visibility/owner) are now sent as their OWN
      // scope='series' request inside doSave, so they can no longer drag a time or
      // room change along with them. That means we only skip the scope question
      // when there is nothing scope-dependent left to ask about.
      if (seriesWideChanged && !scopedChanged) { doSave('series'); return }
      setScopeOpen(true); return
    }
    doSave(null)
  }
  const doSave = async (scope) => {
    setScopeOpen(false)
    setLoading(true); setError(''); setVenues(null)
    // timeChanged / titleChanged / kindChanged are derived above (hoisted so save()
    // can see them). Only fields the user ACTUALLY changed are ever sent: sending an
    // untouched field clobbers an occurrence's OTHER customization (editing the title
    // used to revert a custom kind) because the backend applies whatever arrives.
    const ns = nsNow, ne = neNow
    if (!ns || !ne) { setLoading(false); setError('Pick a date and time first.'); return }
    // Same rule for the new fields (roomChanged/groupsChanged/publicChanged are
    // derived above): only send a key the user actually touched. Sending
    // `resource_id` on a rename would read as "set the room", and null would strip it.
    try {
      const payload = {}
      if (titleChanged) payload.title = title.trim()
      if (kindChanged) payload.event_kind_id = kindId
      if (timeChanged) { payload.start_time = ns; payload.end_time = ne }
      if (roomChanged) payload.resource_id = roomId === ROOM_NONE ? null : roomId
      if (scope) payload.scope = scope
      // 'occurrence'/'following' act on a specific day; 'series' ignores it
      if (scope === 'occurrence' || scope === 'following') payload.occurrence_date = event.occurrenceDate

      // Groups / visibility / owner belong to the SERIES root, so they go as their
      // own scope='series' request. Bundling them into the scoped payload above used
      // to force scope='series' for everything — silently re-timing the WHOLE series
      // when the user had scoped a time change to one date. Sent first so a later
      // clash on the scoped part can't leave them half-applied in the other order.
      if (groupsChanged || publicChanged || organizerChanged) {
        const wide = {}
        if (groupsChanged) wide.group_ids = groupIds
        if (publicChanged) wide.is_public = isPublic
        if (organizerChanged) wide.organizer_id = organizerId
        if (event.is_recurring) wide.scope = 'series'
        await api.patch(`/events/${event.id}`, wide)
      }
      // Nothing scope-dependent left? Then the series-wide request WAS the save.
      if (Object.keys(payload).filter(k => k !== 'scope' && k !== 'occurrence_date').length) {
        await api.patch(`/events/${event.id}`, payload)
      }
      snack(scope === 'following' ? 'This and following updated' : scope === 'series' ? 'Series updated' : 'Event updated')
      onDone()
    } catch (err) {
      if (err.response?.status === 409) {
        try {
          const r = await api.get(`/clashes/event/${event.id}`, { params: { start: ns, end: ne } })
          const vb = (r.data || []).flatMap(c => c.venue_bookings || [])
          if (vb.length) { setVenues({ list: vb, start: ns, end: ne }); setLoading(false); return }
        } catch { /* ignore */ }
      }
      setError(errText(err, 'That time is busy.'))
    } finally { setLoading(false) }
  }
  const requestSlot = async (vb) => {
    if (sending) return                       // a double-tap used to fire two POSTs
    setSending(vb.booking_id)
    try {
      await api.post('/release-requests', { booking_id: vb.booking_id, message: '', proposed_event: { move_event_id: event.id, start_time: venues.start, end_time: venues.end } })
      setSent(s => ({ ...s, [vb.booking_id]: true })); snack('Request sent')
    } catch (e) { snack(errText(e, 'Could not send request')) }
    finally { setSending(null) }
  }
  const labelOf = (v) => label12(v)

  return (
    <>
    {picking && <EditTimePicker event={event} date={date}
      onClose={() => setPicking(false)}
      // clearing `venues` matters: the clash panel used to survive a time change,
      // and since Save was hidden while it showed, you could never save again
      onPick={(d, s, e) => { setDate(d); setStart(s); setEnd(e); setVenues(null); setError(''); setPicking(false) }} />}
    <RecurringScopeSheet open={scopeOpen} action="move"
      title={title || event.title}
      hasOccurrence={!!event.occurrenceDate}
      when={event.occurrenceDate ? format(parseISO(event.occurrenceDate), 'EEE, MMM d') : ''}
      onClose={() => setScopeOpen(false)} onPick={doSave} />
    <SheetV3 open={!!event} onClose={onClose} title="Edit event">
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <div><label className="m-label">Title</label>
          <input className="m-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" /></div>
        <div><label className="m-label">When</label>
          <button type="button" onClick={() => setPicking(true)}
            style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, display: 'block' }}>{date ? format(parseISO(`${date}T00:00`), 'EEE, MMM d') : '—'}</span>
              <span className="m-muted" style={{ fontSize: '0.84rem' }}>{labelOf(start)} – {labelOf(end)}</span>
            </span>
            <span className="m-muted" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.84rem', flex: '0 0 auto' }}>Change<ChevronRight size={16} /></span>
          </button>
        </div>
        <div><label className="m-label">Kind</label>
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

        {/* ── Venue ── the room can finally be changed after creation. "Not decided
            yet" clears the room entirely (reserves nothing, blocks nobody). */}
        <div><label className="m-label">Venue</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            {rooms.map(r => (
              <button key={r.id} type="button" className={`m-chip ${roomId === r.id ? 'm-chip--active' : ''}`}
                onClick={() => { haptic(); touched.current = true; setRoomId(r.id); setError('') }}>
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: venueColorForName(r.name, theme), marginRight: 6, verticalAlign: 'middle' }} />
                {r.name}
              </button>
            ))}
            <button type="button" className={`m-chip ${roomId === ROOM_NONE ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); touched.current = true; setRoomId(ROOM_NONE); setError('') }}>
              Not decided yet
            </button>
          </div>
          {roomChanged && (
            <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6, marginLeft: 2 }}>
              {roomId === ROOM_NONE ? 'Releases the current room.' : 'Checked for clashes on save.'}
            </div>
          )}
        </div>

        {/* ── Groups ── MULTI-select, unlike every other chip row on this sheet.
            Venue and Visibility above are single-select: tapping a different chip
            moves the selection and tapping the live one is a no-op. Groups toggles,
            so tapping a group that is already on REMOVES it.

            Those two behaviours used to look identical — same `m-chip`, same
            `m-chip--active` — and a user tapping the group their event was created
            with, expecting to confirm it, silently cleared it instead. The tick
            (and aria-pressed, which is what a toggle button actually is) says
            "on, tap to remove" where a plain fill only says "on". */}
        {allGroups.length > 0 && (
          <div><label className="m-label">Groups</label>
            <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
              {allGroups.map(g => {
                const on = groupIds.includes(g.id)
                return (
                  <button key={g.id} type="button" className={`m-chip ${on ? 'm-chip--active' : ''}`}
                    aria-pressed={on} title={on ? `Remove ${g.name}` : `Add ${g.name}`}
                    onClick={() => { haptic(); touched.current = true; setGroupIds(ids => on ? ids.filter(x => x !== g.id) : [...ids, g.id]) }}>
                    {on && <Check size={14} strokeWidth={3} style={{ marginRight: 5, verticalAlign: '-2px' }} />}
                    {g.name}
                  </button>
                )
              })}
            </div>
            {/* Clearing the last group is the one destructive outcome of a toggle, and
                it is invisible on the calendar unless you happen to have a cohort
                filter on — so name it rather than leaving an empty row. */}
            {groupsChanged && (
              <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6, marginLeft: 2 }}>
                {groupIds.length === 0 ? 'No cohort — drops out of cohort filters.' : 'Tap a ticked group to remove it.'}
              </div>
            )}
          </div>
        )}

        {/* ── Organizer (admin only) ── lets an admin hand an imported class to the
            faculty who actually teaches it. The room claim follows the new owner. */}
        {isAdmin && people.length > 0 && (
          <div><label className="m-label">Organizer</label>
            <select className="m-input" value={organizerId}
              onChange={e => { touched.current = true; setOrganizerId(e.target.value); setError('') }}>
              {!people.some(p => p.id === organizerId) && (
                <option value={organizerId}>{event.organizer_name || 'Current owner'}</option>
              )}
              {people.map(p => (
                <option key={p.id} value={p.id}>{p.full_name} · {p.role}</option>
              ))}
            </select>
            {organizerChanged && (
              <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6, marginLeft: 2 }}>
                Takes over the room too.
              </div>
            )}
          </div>
        )}

        {/* ── Visibility ── */}
        <div><label className="m-label">Visibility</label>
          <div className="m-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
            <button type="button" className={`m-chip ${isPublic ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); touched.current = true; setIsPublic(true) }}>Public</button>
            <button type="button" className={`m-chip ${!isPublic ? 'm-chip--active' : ''}`}
              onClick={() => { haptic(); touched.current = true; setIsPublic(false) }}>Private</button>
          </div>
          <div className="m-muted" style={{ fontSize: '0.76rem', marginTop: 6, marginLeft: 2 }}>
            {isPublic ? 'Anyone can see it.' : 'Only you and admins.'}
          </div>
        </div>

        {/* Groups, visibility and owner live on the series ROOT — there is no
            per-date version of them — so changing one hits every date and the scope
            sheet never appears. Say so before the user saves.

            This used to be a row of four inert `m-chip`s labelled Venue / Groups /
            Visibility / Owner, under the heading "Applies to series". Two problems,
            both reported: the chips were pixel-identical to the REAL chips directly
            above yet did nothing, so they read as an unanswered choice; and the list
            was hard-coded, so it named Venue — which is NOT series-wide (a single
            occurrence carries its own booking and a room change gets scoped like a
            time change). It announced a blast radius the code doesn't apply.
            A sentence naming only what actually changed can't drift like that. */}
        {event.is_recurring && seriesWideChanged && (
          <div className="m-warn" style={{ fontSize: '0.84rem' }}>
            Changes {wideList} on every date in this series.
          </div>
        )}
        {venues && (
          <div className="m-warn">
            <strong>Slot taken.</strong>
            {venues.list.map(vb => {
              const mine = vb.holder_id === user?.id
              return (
                <div key={vb.booking_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 6, fontSize: '0.84rem' }}>
                  <span style={{ minWidth: 0 }}>{vb.resource_name} · {mine ? 'held by you' : vb.holder_name}</span>
                  {/* you can't request a slot from yourself — the API rejects it */}
                  {mine ? <em className="m-muted">move it yourself</em>
                    : sent[vb.booking_id] ? <em style={{ color: 'var(--ok)' }}>sent ✓</em>
                    : <button type="button" className="m-link" disabled={!!sending} onClick={() => requestSlot(vb)}>
                        {sending === vb.booking_id ? 'Sending…' : 'Request'}
                      </button>}
                </div>
              )
            })}
          </div>
        )}
        {error && <p className="m-error">{error}</p>}
        {/* always available — hiding it behind `venues` was a dead end */}
        <Btn variant="primary" full loading={loading} onClick={save}>Save</Btn>
      </div>
    </SheetV3>
    </>
  )
}

// Full-screen day calendar for rescheduling — shows the day's other events and a
// live clash warning (from DayGrid) so you can drop the event into a free slot.
// The event being edited is hidden so it doesn't flag itself as a conflict.
function EditTimePicker({ event, date, onClose, onPick }) {
  const [theme] = useTheme()
  // Guard the seed: an invalid `date` would make every downstream call throw
  // (toISOString on the fetch, format in the header) and blank the screen.
  const [day, setDay] = useState(() => {
    const d = date ? parseISO(`${date}T00:00`) : null
    return (d && !Number.isNaN(d.getTime())) ? startOfDay(d) : startOfDay(new Date())
  })
  const [events, setEvents] = useState(null)

  const load = useCallback(() => {
    setEvents(null)
    api.get('/events/calendar', { params: { start: startOfDay(day).toISOString(), end: endOfDay(day).toISOString() } })
      .then(r => setEvents((r.data || []).filter(e => {
        // Hide ONLY the occurrence being moved — never the rest of its series.
        // Every occurrence of a recurring event shares the root id, so filtering
        // by id alone wiped Monday AND Friday off the grid, hiding real bookings.
        // Match the one occurrence by its original slot instead; the others stay
        // visible so you can see (and avoid) them while choosing the new time.
        if (event.is_recurring && event.occurrenceDate) {
          return !(e.id === event.id && (e.original_time || e.start) === event.occurrenceDate)
        }
        return e.id !== event.id
      })))
      .catch(() => setEvents([]))
  }, [day, event.id])
  useEffect(() => { load() }, [load])
  useBackClose(true, onClose)

  return ReactDOM.createPortal(
    <div className="v-moveoverlay" style={{ zIndex: 1100 }}>
      <div className="v-moveoverlay__head">
        <button className="v-iconbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Pick a new time</div>
          <div className="m-muted" style={{ fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</div>
        </div>
        <div style={{ width: 40, flex: '0 0 40px' }} />
      </div>

      <div className="v-moveoverlay__nav">
        <button className="v-iconbtn" onClick={() => setDay(d => addDays(d, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <DateJump day={day} onPick={setDay} />
        <button className="v-iconbtn" onClick={() => setDay(d => addDays(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      <div className="v-moveoverlay__body">
        <DayGrid cursor={day} today={new Date()} events={events || []}
          eventColor={(e) => eventColorFor(e, theme)} confirmLabel="Use this time"
          onConfirm={(s, e) => onPick(format(day, 'yyyy-MM-dd'), s, e)} />
      </div>
    </div>,
    document.body,
  )
}
