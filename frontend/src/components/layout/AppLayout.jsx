import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import {
  LayoutDashboard, CalendarDays, BookOpen,
  Building2, Users, Bell, LogOut, Menu, X, ChevronRight, GraduationCap, ArrowLeftRight
} from 'lucide-react'
import { Badge } from '../ui'
import FeedbackWidget from '../FeedbackWidget'
const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/bookings', icon: BookOpen, label: 'Bookings' },
  { to: '/resources', icon: Building2, label: 'Resources' },
  { to: '/groups', icon: GraduationCap, label: 'Groups' },
  { to: '/requests', icon: ArrowLeftRight, label: 'Requests' },
  { to: '/notifications', icon: Bell, label: 'Notifications' },
]

const ADMIN_NAV = [
  { to: '/users', icon: Users, label: 'Users' },
]

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => { logout(); navigate('/login') }
  const isAdmin = user?.role === 'admin'

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__logo">
          <span className="sidebar__logo-mark">RSP</span>
          <span className="sidebar__logo-text">Scheduler</span>
          <button className="sidebar__close-btn" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <FeedbackWidget />
        <nav className="sidebar__nav">
          <div className="sidebar__section">
            <p className="sidebar__section-label">Main</p>
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to} to={to} end={to === '/'}
                className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={17} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>

          {isAdmin && (
            <div className="sidebar__section">
              <p className="sidebar__section-label">Admin</p>
              {ADMIN_NAV.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to} to={to}
                  className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="sidebar__user">
          <div className="sidebar__user-info">
            <div className="sidebar__avatar">{user?.full_name?.[0]?.toUpperCase()}</div>
            <div>
              <p className="sidebar__user-name">{user?.full_name}</p>
              <Badge label={user?.role} type={user?.role} />
            </div>
          </div>
          <button className="sidebar__logout" onClick={handleLogout} title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="app-main">
        <header className="topbar">
          <button className="topbar__menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="topbar__right">
            <span className="topbar__greeting">Hello, {user?.full_name?.split(' ')[0]}</span>
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
