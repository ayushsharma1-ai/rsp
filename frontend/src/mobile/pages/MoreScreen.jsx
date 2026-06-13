import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, GraduationCap, ArrowLeftRight, Users, MessageSquare, Sun, Moon, LogOut, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useTheme, haptic } from '../theme'

function Row({ icon: Icon, label, onClick, danger }) {
  return (
    <button className={`m-card m-listbtn ${danger ? 'm-listbtn--danger' : ''}`} onClick={() => { haptic(); onClick() }}>
      <Icon size={20} />
      <span>{label}</span>
      <ChevronRight size={18} style={{ marginLeft: 'auto', opacity: 0.4 }} />
    </button>
  )
}

export function MoreScreen() {
  const { user, logout } = useAuthStore()
  const [theme, toggle] = useTheme()
  const nav = useNavigate()
  const isAdmin = user?.role === 'admin'

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="m-avatar">{(user?.full_name || '?')[0]?.toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{user?.full_name}</div>
          <div className="m-muted" style={{ fontSize: '0.82rem' }}>{user?.email}</div>
          <span className="m-badge" style={{ marginTop: 6 }}>{user?.role}</span>
        </div>
      </div>

      <Row icon={Building2} label="Resources" onClick={() => nav('/resources')} />
      <Row icon={GraduationCap} label="Groups & Roster" onClick={() => nav('/groups')} />
      <Row icon={ArrowLeftRight} label="Slot Requests" onClick={() => nav('/requests')} />
      {isAdmin && <Row icon={Users} label="Users" onClick={() => nav('/users')} />}
      <Row icon={MessageSquare} label="Feedback" onClick={() => nav('/feedback')} />
      <Row icon={theme === 'dark' ? Sun : Moon} label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={toggle} />
      <Row icon={LogOut} label="Log out" onClick={logout} danger />
    </div>
  )
}
