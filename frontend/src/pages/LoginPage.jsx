import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { Btn, Field } from '../components/ui'

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'professor' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuthStore()
  const navigate = useNavigate()

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(form.email, form.password)
      } else {
        await register(form.email, form.full_name, form.password, form.role)
      }
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const fill = (email, password) => setForm(f => ({ ...f, email, password }))

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo__mark">RSP</span>
          <p className="auth-logo__sub">Resource Scheduling Platform</p>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`} onClick={() => setMode('login')}>
            Sign In
          </button>
          <button className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && (
            <Field label="Full Name">
              <input value={form.full_name} onChange={set('full_name')} placeholder="Dr. Jane Smith" required />
            </Field>
          )}

          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} placeholder="you@university.edu" required />
          </Field>

          <Field label="Password">
            <input type="password" value={form.password} onChange={set('password')} placeholder="••••••••" required minLength={6} />
          </Field>

          {mode === 'register' && (
            <Field label="Role">
              <select value={form.role} onChange={set('role')}>
                <option value="professor">Professor</option>
                <option value="staff">Staff</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
          )}

          {error && <p className="auth-error">{error}</p>}

          <Btn type="submit" loading={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </Btn>
        </form>

        {mode === 'login' && (
          <div className="auth-demo">
            <p className="auth-demo__title">Demo accounts</p>
            <div className="auth-demo__btns">
              <button onClick={() => fill('admin@rsp.edu', 'admin123')} className="demo-btn demo-btn--admin">Admin</button>
              <button onClick={() => fill('alice@rsp.edu', 'alice123')} className="demo-btn">Prof. Alice</button>
              <button onClick={() => fill('bob@rsp.edu', 'bob123')} className="demo-btn">Prof. Bob</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
