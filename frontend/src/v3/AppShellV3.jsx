import React, { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, Settings, ChevronLeft, Sun, Moon } from 'lucide-react'
import { useTheme, haptic } from '../mobile/theme'
import api from '../lib/api'
import { useAutoRefresh } from './useAutoRefresh'

// Tab bar: Notifications · Calendar (center, default) · Settings.
const TAB_PATHS = ['/', '/notifications', '/settings']
const TITLES = {
  '/': 'Calendar', '/notifications': 'Activity', '/settings': 'Settings',
  '/bookings': 'Bookings', '/requests': 'Slot Requests', '/feedback': 'Feedback',
  '/groups': 'Groups & Members', '/users': 'Users',
}

export default function AppShellV3() {
  const [theme, toggle] = useTheme()
  const loc = useLocation()
  const navigate = useNavigate()
  const isTab = TAB_PATHS.includes(loc.pathname)
  const title = TITLES[loc.pathname] || 'RSP'

  // unread-notification dot on the Activity tab
  const [unread, setUnread] = useState(0)
  const loadUnread = useCallback(() => {
    api.get('/users/me/notifications')
      .then(r => setUnread(r.data.filter(n => !n.is_read).length))
      .catch(() => {})
  }, [])
  useEffect(() => { loadUnread() }, [loadUnread, loc.pathname]) // refresh when you change tabs
  useAutoRefresh(loadUnread, 30000)

  return (
    <div className="v-app">
      <header className="v-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!isTab && (
            <button className="v-iconbtn" onClick={() => { haptic(); navigate(-1) }} aria-label="Back"><ChevronLeft size={20} /></button>
          )}
          <span className="v-topbar__title">{title}</span>
        </div>
        <button className="v-iconbtn" onClick={() => { haptic(); toggle() }} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </header>

      <main className="v-content"><Outlet /></main>

      <nav className="v-tabbar">
        <NavLink to="/notifications" onClick={haptic} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Bell size={22} />
            {unread > 0 && <span className="v-tab__dot" />}
          </span>
          <span>Activity</span>
        </NavLink>
        <NavLink to="/" end onClick={haptic} className={({ isActive }) => `v-tab v-tab--center ${isActive ? 'v-tab--active' : ''}`}>
          <span className="v-tab__badge"><CalendarDays size={26} /></span>
        </NavLink>
        <NavLink to="/settings" onClick={haptic} className={({ isActive }) => `v-tab ${isActive ? 'v-tab--active' : ''}`}>
          <Settings size={22} /><span>Settings</span>
        </NavLink>
      </nav>
    </div>
  )
}
