import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import './components/ui/styles.css'
import './components/layout/layout.css'
import './pages/pages.css'

import { useAuthStore } from './store/authStore'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import CalendarPage from './pages/CalendarPage'
import BookingsPage from './pages/BookingsPage'
import ResourcesPage from './pages/ResourcesPage'
import GroupsPage from './pages/GroupsPage'
import RequestsPage from './pages/RequestsPage'
import NotificationsPage from './pages/NotificationsPage'
import UsersPage from './pages/UsersPage'

function RequireAuth({ children }) {
  const { token } = useAuthStore()
  return token ? children : <Navigate to="/login" replace />
}

function RequireAdmin({ children }) {
  const { user } = useAuthStore()
  return user?.role === 'admin' ? children : <Navigate to="/" replace />
}

function App() {
  const { token } = useAuthStore()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<DashboardPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="resources" element={<ResourcesPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
