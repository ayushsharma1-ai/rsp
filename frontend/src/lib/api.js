import axios from 'axios'

// const api = axios.create({ baseURL: '/api/v1' })
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1'
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Only force a re-login when a token we HAD got rejected (expired session).
    // Anonymous callers (no token) are allowed — e.g. viewing the public calendar —
    // so a 401 on a logged-in-only call just rejects and the caller handles it.
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
