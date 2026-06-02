import { create } from 'zustand'
import api from '../lib/api'

export const useAuthStore = create((set) => ({
  user: (() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })(),
  token: localStorage.getItem('token'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data))
    set({ user: data, token: data.access_token })
    return data
  },

  register: async (email, full_name, password, role) => {
    const { data } = await api.post('/auth/register', { email, full_name, password, role })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data))
    set({ user: data, token: data.access_token })
    return data
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null })
  },
}))
