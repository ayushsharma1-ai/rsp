import React from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, CalendarDays, BookOpen, Bell, Menu, Sun, Moon, ChevronLeft } from 'lucide-react'
import { useTheme, haptic } from './theme'

const TABS = [
  { to: '/', icon: Home, label: 'Home', end: true },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/bookings', icon: BookOpen, label: 'Bookings' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/more', icon: Menu, label: 'More' },
]
const TAB_PATHS = ['/', '/calendar', '/bookings', '/alerts', '/more']
const TITLES = {
  '/': 'Home', '/calendar': 'Calendar', '/bookings': 'Bookings', '/alerts': 'Alerts', '/more': 'More',
  '/resources': 'Resources', '/groups': 'Groups', '/requests': 'Requests', '/users': 'Users', '/feedback': 'Feedback',
}

export default function AppShell() {
  const [theme, toggle] = useTheme()
  const loc = useLocation()
  const navigate = useNavigate()
  const isTab = TAB_PATHS.includes(loc.pathname)
  const title = TITLES[loc.pathname] || 'RSP'

  return (
    <div className="m-app">
      <header className="m-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {!isTab && (
            <button className="m-iconbtn" onClick={() => { haptic(); navigate(-1) }} aria-label="Back">
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="m-topbar__title">{title}</span>
        </div>
        <button className="m-iconbtn" onClick={() => { haptic(); toggle() }} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </header>

      <main className="m-content">
        <Outlet />
      </main>

      <nav className="m-tabbar">
        {TABS.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to} to={to} end={end} onClick={() => haptic()}
            className={({ isActive }) => `m-tab ${isActive ? 'm-tab--active' : ''}`}
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
