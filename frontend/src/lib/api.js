import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1'
})

// Attach the current access token to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Silent access-token refresh ──────────────────────────────────────────────
// When a request comes back 401 (access token expired), we quietly exchange the
// refresh token for a new access token and REPLAY the original request. The user
// sees nothing. If the refresh also fails, the session is genuinely over.

let refreshing = null   // a single in-flight refresh, shared by all requests that 401 at once

function endSession() {
  localStorage.removeItem('token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
  // Land on the LOGIN page and say why (LoginV3 reads the flag). The old
  // behaviour — silently reloading wherever you were — stripped the tab bar and
  // buttons with zero explanation; the audit logged it as "buttons get vanished".
  sessionStorage.setItem('rsp-session-expired', '1')
  window.location.hash = '#/login'
  window.location.reload()
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config
    const status = err.response?.status
    const refreshToken = localStorage.getItem('refresh_token')
    const isAuthCall = original?.url?.includes('/auth/refresh') || original?.url?.includes('/auth/login')

    // Only try to refresh when: it's a 401, we HAVE a refresh token, we haven't
    // already retried THIS request, and the failing call isn't the refresh/login itself.
    if (status === 401 && refreshToken && !original._retried && !isAuthCall) {
      original._retried = true
      try {
        // De-dupe: if several requests 401 together, they all await ONE refresh.
        refreshing = refreshing || api
          .post('/auth/refresh', { refresh_token: refreshToken })
          .then((res) => {
            localStorage.setItem('token', res.data.access_token)
            return res.data.access_token
          })
          .finally(() => { refreshing = null })

        const newToken = await refreshing
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)                 // replay — the request interceptor re-attaches the new token too
      } catch (e) {
        endSession()                         // refresh rejected → truly logged out
        return Promise.reject(e)
      }
    }

    return Promise.reject(err)
  }
)

export default api
