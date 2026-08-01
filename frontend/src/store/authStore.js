import { create } from 'zustand'
import api from '../lib/api'

// Two tokens (see api.js for the silent-refresh flow):
//   token          — short-lived access JWT, sent on every request
//   refresh_token  — long-lived, revocable; used only to mint new access tokens
// The login response (auth/service.py TokenResponse) names the id `user_id`, but
// call sites naturally reach for `user.id` — so every "is this mine?" comparison
// silently evaluated `undefined === <uuid>` and was always false: the clash panel
// claimed your own booking was held by someone else and offered to request a slot
// from yourself. Normalise once, here, rather than patching each reader — the next
// reader would make the same assumption. Applied to the stored value too, so
// sessions that are already signed in are fixed without re-login.
const withId = (u) => (u && !u.id && u.user_id ? { ...u, id: u.user_id } : u)

export const useAuthStore = create((set) => ({
  user: (() => {
    try { return withId(JSON.parse(localStorage.getItem('user'))) } catch { return null }
  })(),
  token: localStorage.getItem('token'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    localStorage.setItem('user', JSON.stringify(data))
    set({ user: withId(data), token: data.access_token })
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
