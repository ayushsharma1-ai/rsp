import { create } from 'zustand'
import api from '../lib/api'

// Two tokens (see api.js for the silent-refresh flow):
//   token          — short-lived access JWT, sent on every request
//   refresh_token  — long-lived, revocable; used only to mint new access tokens
export const useAuthStore = create((set) => ({
  user: (() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })(),
  token: localStorage.getItem('token'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('user', JSON.stringify(data))
    set({ user: data, token: data.access_token })
    return data
  },

  logout: async () => {
    // Revoke the refresh token server-side so it can't renew again. Best-effort:
    // even if the call fails (offline, expired), we still clear the browser.
    const rt = localStorage.getItem('refresh_token')
    if (rt) { try { await api.post('/auth/logout', { refresh_token: rt }) } catch { /* ignore */ } }
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
    set({ user: null, token: null })
  },
}))
