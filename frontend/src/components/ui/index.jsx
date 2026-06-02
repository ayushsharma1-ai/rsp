import React from 'react'

// ── Button ────────────────────────────────────────────────────
export function Btn({ children, variant = 'primary', size = 'md', loading, className = '', ...props }) {
  const base = `btn btn--${variant} btn--${size} ${className}`
  return (
    <button className={base} disabled={loading || props.disabled} {...props}>
      {loading ? <Spinner size={14} /> : children}
    </button>
  )
}

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, className = '', style }) {
  return <div className={`card ${className}`} style={style}>{children}</div>
}

// ── Badge ─────────────────────────────────────────────────────
const badgeColors = {
  confirmed: 'green', approved: 'green', active: 'green',
  pending: 'yellow', draft: 'yellow',
  rejected: 'red', cancelled: 'red', inactive: 'red',
  admin: 'accent', professor: 'accent', staff: 'text2', viewer: 'text2',
  classroom: 'accent', lab: 'green', seminar_hall: 'yellow',
  meeting_room: 'text2', equipment: 'text2', other: 'text2',
}
export function Badge({ label, type }) {
  const c = badgeColors[type] || badgeColors[label?.toLowerCase()] || 'text2'
  return <span className={`badge badge--${c}`}>{label}</span>
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="spinner">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  )
}

// ── Modal ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, width = 520 }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()}>
        <div className="modal__header">
          <h3>{title}</h3>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}

// ── Form Field ────────────────────────────────────────────────
export function Field({ label, error, children, hint }) {
  return (
    <div className="field">
      {label && <label className="field__label">{label}</label>}
      {children}
      {hint && <p className="field__hint">{hint}</p>}
      {error && <p className="field__error">{error}</p>}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
export function Empty({ icon, title, subtitle }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <p className="empty__title">{title}</p>
      {subtitle && <p className="empty__subtitle">{subtitle}</p>}
    </div>
  )
}

// ── Page Header ───────────────────────────────────────────────
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

// ── Table ─────────────────────────────────────────────────────
export function Table({ columns, data, onRow }) {
  if (!data?.length) return <Empty title="No records found" subtitle="Nothing here yet." />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={row.id || i} onClick={() => onRow?.(row)} style={onRow ? { cursor: 'pointer' } : {}}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(row[c.key], row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
