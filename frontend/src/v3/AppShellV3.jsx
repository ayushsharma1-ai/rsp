import React, { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, Settings, ChevronLeft, BookOpen, ArrowLeftRight, GraduationCap, Users, Plus } from 'lucide-react'
import { haptic } from '../mobile/theme'
import { useAuthStore } from '../store/authStore'
import { useAuthGate } from './AuthGateV3'
import api from '../lib/api'
import { useAutoRefresh } from './useAutoRefresh'
import { useKeyboardFit } from './useKeyboardFit'
import { publishUnread, peekUnread, subscribeUnread } from './unreadBus'

// Tab bar: Notifications · Calendar (center, default) · Settings.
const TAB_PATHS = ['/', '/notifications', '/settings']
const TITLES = {
  '/': 'Calendar', '/notifications': 'Activity', '/settings': 'Settings',
  '/bookings': 'Bookings', '/requests': 'Slot Requests', '/feedback': 'Feedback',
  '/groups': 'Groups & Members', '/users': 'Users',
  '/rooms': 'Rooms', '/kinds': 'Event Kinds', '/feedback-inbox': 'Feedback Inbox',
}

export default function AppShellV3() {
  // iOS never shrinks the layout viewport for the keyboard, and the shell is
  // position:fixed inset:0 — so .v-content kept full height, had nothing to
  // scroll, and any field in the lower half was simply unreachable on a
  // shorter iPhone. Clamping the shell to the visible height while the
  // keyboard is up gives .v-content something to scroll again.
  const kbFit = useKeyboardFit({ scroll: false })
  const { user } = useAuthStore()
  const { requireLogin } = useAuthGate()
  const loc = useLocation()
  const navigate = useNavigate()

  // Anonymous tap on a personal tab → pop the login sheet (and resume to that tab
  // after sign-in), instead of bouncing to the full login page. The route's own
  // RequireAuth still guards direct-URL access.
  const gateTab = (e, to) => { haptic(); if (!user) { e.preventDefault(); requireLogin(() => navigate(to)) } }

  // Desktop sidebar item (hidden on mobile via CSS). Public items navigate; personal
  // items pop the login sheet when logged out (same rule as the mobile tabs).
  const sideItem = (to, Icon, label, gated = true, dot = false) => (
    <NavLink key={to} to={to} end={to === '/'}
      onClick={(e) => { haptic(); if (gated && !user) { e.preventDefault(); requireLogin(() => navigate(to)) } }}
      className={({ isActive }) => `v-side__link ${isActive ? 'v-side__link--active' : ''}`}>
      <span style={{ position: 'relative', display: 'inline-flex' }}><Icon size={19} />{dot && <span className="v-tab__dot" />}</span>
      <span>{label}</span>
    </NavLink>
  )
  const isTab = TAB_PATHS.includes(loc.pathname)
  const title = TITLES[loc.pathname] || 'Scheduler'
  const onCalendar = loc.pathname === '/'
  const isEditor = user && user.role !== 'viewer'

  // Ask the calendar to open its create flow: navigate to the calendar carrying
  // ?new=<ts> (keeping the current view/date when we're already there). CalendarV3
  // watches for the param. This is the ONE add entry point now the floating FAB
  // is gone — the tab-bar centre and the desktop sidebar both use it.
  const goCreate = () => {
    haptic()
    const params = new URLSearchParams(onCalendar ? loc.search : '')
    params.set('new', String(Date.now()))
    navigate({ pathname: '/', search: params.toString() })
  }
  // The centre tab is context-aware so navigation to the calendar isn't lost:
  // an editor sitting ON the calendar sees "+" (create); anywhere else it's the
  // calendar glyph (go to the calendar). Viewers never get "+" — they can't create.
  const centreIsAdd = onCalendar && isEditor
  const onCentre = () => { if (centreIsAdd) goCreate(); else { haptic(); navigate('/') } }

  // Tell the stylesheet whether the bottom tab bar exists. Everything anchored to
  // the bottom (FAB, selection bar, snackbar) measures from --bottom-chrome, and
  // portalled elements like the snackbar can't inherit from .v-app — so the flag
  // lives on <html>.
  useEffect(() => {
    document.documentElement.dataset.tabbar = user ? 'on' : 'off'
  }, [user])

  // unread-notification dot on the Activity tab — only for logged-in users.
  // The count comes from a shared store (unreadBus) because the notifications
  // SCREEN is what changes read state. When this component owned the number
  // privately, "Mark all read" left the dot up until the next poll or route
  // change — the dot appeared to clear only when you switched tabs.
  const [unread, setUnread] = useState(() => peekUnread() ?? 0)
  useEffect(() => subscribeUnread(setUnread), [])
  const loadUnread = useCallback(() => {
    if (!user) { publishUnread(0); return }   // anonymous: nothing personal to load
    api.get('/users/me/notifications')
      .then(r => publishUnread(r.data.filter(n => !n.is_read).length))
      .catch(() => {})
  }, [user])
  useEffect(() => { loadUnread() }, [loadUnread, loc.pathname]) // refresh when you change tabs
  useAutoRefresh(loadUnread, 30000)

  return (
    <div className="v-app" ref={kbFit}>
      {/* Desktop-only left sidebar (CSS-hidden on mobile, where the bottom tab bar shows instead) */}
      <aside className="v-sidebar">
        <div className="v-sidebar__brand">
          {/* the calendar glyph, not initials — no invented wordmark */}
          <span className="v-sidebar__logo"><CalendarDays size={19} /></span>
          <span className="v-sidebar__name">Scheduler</span>
        </div>
        {/* Desktop lost its floating "+" with the FAB, so add a real button. The
            sidebar keeps a Calendar link below for plain viewing. */}
        {isEditor && (
          <button className="m-btn m-btn--primary m-btn--full" style={{ marginBottom: 12 }} onClick={goCreate}>
            <Plus size={18} /> New event
          </button>
        )}
        <nav className="v-sidebar__nav">
          {/* Signed out, the calendar is the whole product — personal areas would
              only bounce to a login prompt, so they don't exist until you're in.
              The "Sign in" button in the footer is the one entry point. */}
          {sideItem('/', CalendarDays, 'Calendar', false)}
          {user && sideItem('/notifications', Bell, 'Activity', true, unread > 0)}
          {user && sideItem('/bookings', BookOpen, 'Bookings')}
          {user && sideItem('/requests', ArrowLeftRight, 'Requests')}
          {user?.role === 'admin' && sideItem('/groups', GraduationCap, 'Groups')}
          {user?.role === 'admin' && sideItem('/users', Users, 'Users')}
          {user && sideItem('/settings', Settings, 'Settings')}
        </nav>
        <div className="v-sidebar__foot">
          {/* theme switching moved to Settings — chrome carries navigation only */}
          {user
            ? <div className="m-muted" style={{ fontSize: '0.82rem', padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</div>
            : <button className="m-chip m-chip--active" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { haptic(); requireLogin() }}>Sign in</button>}
        </div>
      </aside>

      {/* No topbar on the signed-in calendar: its "Calendar" title duplicated the
          month heading below it and the theme button now lives in Settings — the
          row was pure chrome, so the grid gets it back. Anonymous visitors keep
          it (it carries their only Sign in), as do all other screens (title+back). */}
      {!(onCalendar && user) && (
        <header className="v-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {!isTab && (
              <button className="v-iconbtn" onClick={() => { haptic(); navigate(-1) }} aria-label="Back"><ChevronLeft size={20} /></button>
            )}
            <span className="v-topbar__title">{title}</span>
          </div>
          {!user && (
            <button className="m-chip m-chip--active" onClick={() => { haptic(); requireLogin() }}>Sign in</button>
          )}
        </header>
      )}

      {/* Calendar gets the fixed-chrome layout: header rows pinned, grid scrolls inside.
          Signed out there's no tab bar, so its reserved bottom padding goes too.
          --notop: with the topbar gone the content itself must clear the notch. */}
      <main className={`v-content ${onCalendar ? 'v-content--cal' : ''} ${!user ? 'v-content--notab' : ''} ${onCalendar && user ? 'v-content--notop' : ''}`}>
        <div className="v-content__inner"><Outlet /></div>
      </main>

      {/* Signed out there is nowhere to go — every tab is personal. The bar
          disappears and the calendar gets the full screen; the topbar's
          "Sign in" chip is the way in. */}
      {user && (
        <nav className="v-tabbar">
          <NavLink to="/notifications" onClick={(e) => gateTab(e, '/notifications')} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Bell size={22} />
              {unread > 0 && <span className="v-tab__dot" />}
            </span>
            <span>Activity</span>
          </NavLink>
          {/* Centre: "+" on the calendar (create), calendar glyph elsewhere (go
              there). Replaces the redundant calendar tab AND the floating FAB. */}
          <button type="button" onClick={onCentre} aria-label={centreIsAdd ? 'New event' : 'Calendar'}
            className={`v-tab v-tab--center ${onCalendar ? 'v-tab--active' : ''}`}>
            <span className="v-tab__badge">{centreIsAdd ? <Plus size={26} /> : <CalendarDays size={26} />}</span>
          </button>
          <NavLink to="/settings" onClick={(e) => gateTab(e, '/settings')} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
            <Settings size={22} /><span>Settings</span>
          </NavLink>
        </nav>
      )}
    </div>
  )
}
