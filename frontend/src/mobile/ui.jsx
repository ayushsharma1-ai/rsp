import React, { useEffect, useState, useContext, createContext, useCallback } from 'react'
import { haptic } from './theme'

export function Btn({ variant = 'default', full, loading, children, onClick, type = 'button', disabled, style, ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      style={style}
      onClick={(e) => { haptic(); onClick && onClick(e) }}
      className={`m-btn m-btn--${variant} ${full ? 'm-btn--full' : ''}`}
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
  const snack = useCallback((m) => { haptic(); setMsg(m); setTimeout(() => setMsg(null), 2600) }, [])
  return (
    <SnackCtx.Provider value={snack}>
      {children}
      {msg && <div className="m-snackbar">{msg}</div>}
    </SnackCtx.Provider>
  )
}
