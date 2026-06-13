import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './mobile/mobile.css'
import { useAuthStore } from './store/authStore'
import { SnackProvider } from './mobile/ui'
import AppShell from './mobile/AppShell'
import LoginScreen from './mobile/pages/LoginScreen'
import HomeScreen from './mobile/pages/HomeScreen'
import { BookingsScreen } from './mobile/pages/BookingsScreen'
import { AlertsScreen } from './mobile/pages/AlertsScreen'
import { ResourcesScreen } from './mobile/pages/ResourcesScreen'
import { MoreScreen } from './mobile/pages/MoreScreen'
import { CalendarScreen } from './mobile/pages/CalendarScreen'
import { GroupsScreen } from './mobile/pages/GroupsScreen'
import { RequestsScreen } from './mobile/pages/RequestsScreen'
import { UsersScreen } from './mobile/pages/UsersScreen'
import { FeedbackScreen } from './mobile/pages/FeedbackScreen'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ })
  })
}

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  return token ? children : <Navigate to="/login" replace />
}

function MobileApp() {
  const { token } = useAuthStore()
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginScreen />} />
        <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomeScreen />} />
          <Route path="calendar" element={<CalendarScreen />} />
          <Route path="bookings" element={<BookingsScreen />} />
          <Route path="alerts" element={<AlertsScreen />} />
          <Route path="more" element={<MoreScreen />} />
          <Route path="resources" element={<ResourcesScreen />} />
          <Route path="groups" element={<GroupsScreen />} />
          <Route path="requests" element={<RequestsScreen />} />
          <Route path="users" element={<UsersScreen />} />
          <Route path="feedback" element={<FeedbackScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <SnackProvider><MobileApp /></SnackProvider>
)
