import { useEffect, useRef } from 'react'

// Keeps a screen fresh without a manual reload: polls `fn` on an interval AND
// refetches immediately whenever the tab/app regains focus or becomes visible.
// This is how one user's new event shows up on everyone else's calendar.
export function useAutoRefresh(fn, ms = 25000) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const tick = () => { if (ref.current) ref.current() }
    const id = setInterval(tick, ms)
    const onVis = () => { if (document.visibilityState === 'visible') tick() }
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms])
}
