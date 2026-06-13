import { useState, useEffect } from 'react'

// Theme is applied before first paint by the inline script in mobile.html.
// This hook lets any in-app toggle flip + persist it. Because more than one
// component can call useTheme() at once (the app bar + the More screen), the
// DOM attribute is the single source of truth and a window event keeps every
// mounted consumer in sync — otherwise one would hold a stale copy.
const EVT = 'rsp-theme-change'
const current = () => document.documentElement.getAttribute('data-theme') || 'dark'

export function useTheme() {
  const [theme, set] = useState(current)

  useEffect(() => {
    const onChange = () => set(current())
    window.addEventListener(EVT, onChange)
    return () => window.removeEventListener(EVT, onChange)
  }, [])

  const toggle = () => {
    const next = current() === 'dark' ? 'light' : 'dark'   // read DOM, not stale state
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('rsp-theme', next) } catch (e) { /* ignore */ }
    window.dispatchEvent(new Event(EVT))
  }

  return [theme, toggle]
}

// tiny haptic tap (Android / supported browsers); no-op elsewhere
export function haptic(ms = 8) {
  try { navigator.vibrate && navigator.vibrate(ms) } catch (e) { /* ignore */ }
}
