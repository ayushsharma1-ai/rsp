import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './v3/v3.css'
import { useAuthStore } from './store/authStore'
import { SnackProvider } from './mobile/ui'
import AppShellV3 from './v3/AppShellV3'
import LoginV3 from './v3/LoginV3'
import { CalendarV3 } from './v3/CalendarV3'
import { NotificationsV3 } from './v3/NotificationsV3'
import { SettingsV3 } from './v3/SettingsV3'
import { BookingsV3 } from './v3/BookingsV3'
import { GroupsV3 } from './v3/GroupsV3'
import { UsersV3 } from './v3/UsersV3'
// Slot Requests + Feedback are unchanged from v2 — reused as-is.
import { RequestsScreen } from './mobile/pages/RequestsScreen'
import { FeedbackScreen } from './mobile/pages/FeedbackScreen'

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  return token ? children : <Navigate to="/login" replace />
}

function AppV3() {
  const { token } = useAuthStore()
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginV3 />} />
        <Route path="/" element={<RequireAuth><AppShellV3 /></RequireAuth>}>
          <Route index element={<CalendarV3 />} />
          <Route path="notifications" element={<NotificationsV3 />} />
          <Route path="settings" element={<SettingsV3 />} />
          <Route path="bookings" element={<BookingsV3 />} />
          <Route path="groups" element={<GroupsV3 />} />
          <Route path="users" element={<UsersV3 />} />
          <Route path="requests" element={<RequestsScreen />} />
          <Route path="feedback" element={<FeedbackScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <SnackProvider><AppV3 /></SnackProvider>
)
