import React, { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, Settings, ChevronLeft, Sun, Moon, BookOpen, ArrowLeftRight, GraduationCap, Users } from 'lucide-react'
import { useTheme, haptic } from '../mobile/theme'
import { useAuthStore } from '../store/authStore'
import { useAuthGate } from './AuthGateV3'
import api from '../lib/api'
import { useAutoRefresh } from './useAutoRefresh'

// Tab bar: Notifications · Calendar (center, default) · Settings.
const TAB_PATHS = ['/', '/notifications', '/settings']
const TITLES = {
  '/': 'Calendar', '/notifications': 'Activity', '/settings': 'Settings',
  '/bookings': 'Bookings', '/requests': 'Slot Requests', '/feedback': 'Feedback',
  '/groups': 'Groups & Members', '/users': 'Users',
  '/rooms': 'Rooms', '/kinds': 'Event Kinds', '/feedback-inbox': 'Feedback Inbox',
}

export default function AppShellV3() {
  const [theme, toggle] = useTheme()
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
  const title = TITLES[loc.pathname] || 'RSP'

  // unread-notification dot on the Activity tab — only for logged-in users
  const [unread, setUnread] = useState(0)
  const loadUnread = useCallback(() => {
    if (!user) { setUnread(0); return }   // anonymous: nothing personal to load
    api.get('/users/me/notifications')
      .then(r => setUnread(r.data.filter(n => !n.is_read).length))
      .catch(() => {})
  }, [user])
  useEffect(() => { loadUnread() }, [loadUnread, loc.pathname]) // refresh when you change tabs
  useAutoRefresh(loadUnread, 30000)

  return (
    <div className="v-app">
      {/* Desktop-only left sidebar (CSS-hidden on mobile, where the bottom tab bar shows instead) */}
      <aside className="v-sidebar">
        <div className="v-sidebar__brand">
          <span className="v-sidebar__logo">R</span>
          <span className="v-sidebar__name">Scheduler</span>
        </div>
        <nav className="v-sidebar__nav">
          {sideItem('/', CalendarDays, 'Calendar', false)}
          {sideItem('/notifications', Bell, 'Activity', true, unread > 0)}
          {sideItem('/bookings', BookOpen, 'Bookings')}
          {sideItem('/requests', ArrowLeftRight, 'Requests')}
          {sideItem('/groups', GraduationCap, 'Groups')}
          {user?.role === 'admin' && sideItem('/users', Users, 'Users')}
          {sideItem('/settings', Settings, 'Settings')}
        </nav>
        <div className="v-sidebar__foot">
          {user
            ? <div className="m-muted" style={{ fontSize: '0.82rem', padding: '0 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name}</div>
            : <button className="m-chip m-chip--active" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { haptic(); requireLogin() }}>Sign in</button>}
          <button className="v-iconbtn" onClick={() => { haptic(); toggle() }} aria-label="Toggle theme" style={{ alignSelf: 'flex-start' }}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </aside>

      <header className="v-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!isTab && (
            <button className="v-iconbtn" onClick={() => { haptic(); navigate(-1) }} aria-label="Back"><ChevronLeft size={20} /></button>
          )}
          <span className="v-topbar__title">{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!user && (
            <button className="m-chip m-chip--active" onClick={() => { haptic(); requireLogin() }}>Sign in</button>
          )}
          <button className="v-iconbtn" onClick={() => { haptic(); toggle() }} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      <main className="v-content"><div className="v-content__inner"><Outlet /></div></main>

      <nav className="v-tabbar">
        <NavLink to="/notifications" onClick={(e) => gateTab(e, '/notifications')} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Bell size={22} />
            {unread > 0 && <span className="v-tab__dot" />}
          </span>
          <span>Activity</span>
        </NavLink>
        <NavLink to="/" end onClick={haptic} className={({ isActive }) => `v-tab v-tab--center ${isActive ? 'v-tab--active' : ''}`}>
          <span className="v-tab__badge"><CalendarDays size={26} /></span>
        </NavLink>
        <NavLink to="/settings" onClick={(e) => gateTab(e, '/settings')} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
          <Settings size={22} /><span>Settings</span>
        </NavLink>
      </nav>
    </div>
  )
}
