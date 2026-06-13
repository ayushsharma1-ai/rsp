import React from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ArrowLeftRight, MessageSquare, LogOut, ChevronRight, GraduationCap, Users } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { haptic } from '../mobile/theme'

function Row({ icon: Icon, label, onClick, danger }) {
  return (
    <button className={`m-card m-listbtn ${danger ? 'm-listbtn--danger' : ''}`} onClick={() => { haptic(); onClick() }}>
      <Icon size={20} />
      <span>{label}</span>
      <ChevronRight size={18} style={{ marginLeft: 'auto', opacity: 0.4 }} />
    </button>
  )
}

export function SettingsV3() {
  const { user, logout } = useAuthStore()
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

      <Row icon={BookOpen} label="Bookings" onClick={() => nav('/bookings')} />
      <Row icon={ArrowLeftRight} label="Slot Requests" onClick={() => nav('/requests')} />
      <Row icon={GraduationCap} label="Groups & Members" onClick={() => nav('/groups')} />
      {isAdmin && <Row icon={Users} label="Users" onClick={() => nav('/users')} />}
      <Row icon={MessageSquare} label="Feedback" onClick={() => nav('/feedback')} />
      <Row icon={LogOut} label="Log out" onClick={logout} danger />
    </div>
  )
}
