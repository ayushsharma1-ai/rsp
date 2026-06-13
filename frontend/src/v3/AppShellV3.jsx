import React from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, CalendarDays, Settings, ChevronLeft, Sun, Moon } from 'lucide-react'
import { useTheme, haptic } from '../mobile/theme'

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
          <Bell size={22} /><span>Activity</span>
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
