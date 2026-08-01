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
import { ResourcesV3 } from './v3/ResourcesV3'
import { KindsV3 } from './v3/KindsV3'
import { FeedbackInboxV3 } from './v3/FeedbackInboxV3'
// Feedback is unchanged from v2 (no bottom sheet) — reused as-is.
import { FeedbackScreen } from './mobile/pages/FeedbackScreen'

// The palette switcher was retired 2026-07-22 — one official identity (Klein
// blue duo), fully defined in v3.css. Drop any palette a device saved back then.
localStorage.removeItem('rsp-palette')

// (The old JS viewport-height sync was removed 2026-07-23. The shell is now
// `position: fixed; inset: 0` in v3.css, so the browser tracks the real usable
// height itself — no measuring, nothing to go stale on a bfcache restore.)

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  return token ? children : <Navigate to="/login" replace />
}

// Admin-only screens. The API is the real boundary, but without this a professor
// who reached #/users by URL or back-button got a full "Add member" form above an
// empty list — every action on it failing 403.
function RequireAdmin({ children }) {
  const { token, user } = useAuthStore()
  if (!token) return <Navigate to="/login" replace />
  return user?.role === 'admin' ? children : <Navigate to="/" replace />
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
          <Route path="users" element={<RequireAdmin><UsersV3 /></RequireAdmin>} />
          <Route path="requests" element={<RequireAuth><RequestsV3 /></RequireAuth>} />
          {/* admin areas — the API enforces admin-only; these mirror it in the UI */}
          <Route path="rooms" element={<RequireAdmin><ResourcesV3 /></RequireAdmin>} />
          <Route path="kinds" element={<RequireAdmin><KindsV3 /></RequireAdmin>} />
          <Route path="feedback-inbox" element={<RequireAdmin><FeedbackInboxV3 /></RequireAdmin>} />
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
