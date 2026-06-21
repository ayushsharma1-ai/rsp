import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './v3/v3.css'
import { useAuthStore } from './store/authStore'
import { SnackProvider } from './mobile/ui'
import AppShellV3 from './v3/AppShellV3'
import { AuthGateProvider } from './v3/AuthGateV3'
import LoginV3 from './v3/LoginV3'
import { CalendarV3 } from './v3/CalendarV3'
import { NotificationsV3 } from './v3/NotificationsV3'
import { SettingsV3 } from './v3/SettingsV3'
import { BookingsV3 } from './v3/BookingsV3'
import { GroupsV3 } from './v3/GroupsV3'
import { UsersV3 } from './v3/UsersV3'
import { RequestsV3 } from './v3/RequestsV3'
// Feedback is unchanged from v2 (no bottom sheet) — reused as-is.
import { FeedbackScreen } from './mobile/pages/FeedbackScreen'

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  return token ? children : <Navigate to="/login" replace />
}

function AppV3() {
  const { token } = useAuthStore()
  return (
    <HashRouter>
      <AuthGateProvider>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginV3 />} />
        <Route path="/" element={<AppShellV3 />}>
          {/* Calendar is PUBLIC — anyone can view. Everything else needs login. */}
          <Route index element={<CalendarV3 />} />
          <Route path="notifications" element={<RequireAuth><NotificationsV3 /></RequireAuth>} />
          <Route path="settings" element={<RequireAuth><SettingsV3 /></RequireAuth>} />
          <Route path="bookings" element={<RequireAuth><BookingsV3 /></RequireAuth>} />
          <Route path="groups" element={<RequireAuth><GroupsV3 /></RequireAuth>} />
          <Route path="users" element={<RequireAuth><UsersV3 /></RequireAuth>} />
          <Route path="requests" element={<RequireAuth><RequestsV3 /></RequireAuth>} />
          <Route path="feedback" element={<RequireAuth><FeedbackScreen /></RequireAuth>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AuthGateProvider>
    </HashRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <SnackProvider><AppV3 /></SnackProvider>
)
