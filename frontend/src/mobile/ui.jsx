import React, { useEffect, useRef, useState, useContext, createContext, useCallback } from 'react'
import { haptic } from './theme'

// `className` is MERGED, not spread-overridden. It used to arrive via {...rest}
// AFTER the computed className, so any caller passing one silently wiped `m-btn`
// and the button lost all its styling.
export function Btn({ variant = 'default', full, loading, children, onClick, type = 'button', disabled, style, className = '', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      style={style}
      onClick={(e) => { haptic(); onClick && onClick(e) }}
      className={`m-btn m-btn--${variant} ${full ? 'm-btn--full' : ''} ${className}`.trim()}
      {...rest}
    >
      {loading ? <span className="m-spin" /> : children}
    </button>
  )
}

export function Spinner() { return <span className="m-spin" /> }

export function Skeleton({ h = 16, w = '100%', style }) {
  return <div className="m-skel" style={{ height: h, width: w, ...style }} />
}

export function ListSkeleton({ rows = 4, h = 66 }) {
  return <div style={{ display: 'grid', gap: 10 }}>{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} h={h} />)}</div>
}

export function Empty({ icon = '📭', text }) {
  return (
    <div className="m-card" style={{ textAlign: 'center', color: 'var(--text-2)', padding: '28px 16px' }}>
      <div style={{ fontSize: 28, marginBottom: 6 }}>{icon}</div>{text}
    </div>
  )
}

// A failed fetch is NOT an empty list. Rendering "No rooms yet — add one" when the
// server is unreachable invites an admin to re-create data that already exists, so
// load failures get their own state with a way to try again.
export function LoadError({ what = 'that', onRetry }) {
  return (
    <div className="m-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
      <div style={{ fontSize: 26, marginBottom: 6 }}>⚠️</div>
      <div style={{ color: 'var(--text-2)', fontSize: '0.9rem' }}>Couldn’t load {what}.</div>
      <div className="m-muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>Check your connection — your data is safe.</div>
      {onRetry && <Btn style={{ marginTop: 12 }} onClick={onRetry}>Try again</Btn>}
    </div>
  )
}

export function DetailRow({ label, value }) {
  return <div className="m-detailrow"><span className="m-muted">{label}</span><span style={{ fontWeight: 500, textAlign: 'right' }}>{value}</span></div>
}

export function BottomSheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="m-sheet-backdrop" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true">
        <div className="m-sheet__handle" />
        {title && <h3 className="m-sheet__title">{title}</h3>}
        {children}
      </div>
    </>
  )
}

// ---- Snackbar (toast) ----
const SnackCtx = createContext(() => {})
export function useSnack() { return useContext(SnackCtx) }
export function SnackProvider({ children }) {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  // Restart the countdown on every message. Without this, an earlier snack's
  // timer stayed live and wiped the NEXT message partway through its own 2.6s —
  // so back-to-back toasts flashed by too fast to read.
  // Long enough to actually READ. 2.6s was too quick for the longer confirmations
  // ("Request sent to X — Fri, 8 Aug · 2:00–3:15 PM"), which faculty reported
  // vanishing before they could take it in. Scale with length, and let a tap
  // dismiss it early so a slow toast never feels like it's in the way.
  const snack = useCallback((m, ms) => {
    haptic()
    setMsg(m)
    clearTimeout(timer.current)
    const text = typeof m === 'string' ? m : ''
    const dur = ms || Math.min(9000, Math.max(4000, 1500 + text.length * 70))
    timer.current = setTimeout(() => setMsg(null), dur)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  const dismiss = useCallback(() => { clearTimeout(timer.current); setMsg(null) }, [])
  return (
    <SnackCtx.Provider value={snack}>
      {children}
      {msg && (
        <div className="m-snackbar" role="status" aria-live="polite"
             onClick={dismiss} title="Tap to dismiss">{msg}</div>
      )}
    </SnackCtx.Provider>
  )
}
