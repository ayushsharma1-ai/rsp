import React from 'react'
import { Btn } from '../mobile/ui'
import { haptic } from '../mobile/theme'
import SheetV3 from './SheetV3'

// One tappable scope choice: a bold label over a plain-language consequence.
function ScopeOption({ label, sub, onClick, danger }) {
  return (
    <button className="v-scopeopt" onClick={() => { haptic(); onClick() }}>
      <span className="v-scopeopt__label" style={danger ? { color: 'var(--danger)' } : undefined}>{label}</span>
      <span className="v-scopeopt__sub">{sub}</span>
    </button>
  )
}

// Google-style scope chooser for repeating events, shown BEFORE an edit, cancel,
// or a request is honoured. Nothing is pre-selected — you tap the scope you mean.
// When the occurrence isn't known (opened from a notification), only the whole-
// series option is offered, with a nudge to open a specific day.
export default function RecurringScopeSheet({ open, onClose, onPick, title, action = 'move', hasOccurrence = true, when }) {
  const cancel = action === 'cancel'
  const heading = cancel ? `Cancel “${title}”?` : `Change “${title}”?`
  const dayLabel = when ? ` · ${when}` : ''
  return (
    <SheetV3 open={open} onClose={onClose} title={heading}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10, paddingBottom: 8 }}>
        {hasOccurrence ? (
          <>
            <ScopeOption danger={cancel} onClick={() => onPick('occurrence')}
              label={`This event${dayLabel}`}
              sub="Series unaffected." />
            <ScopeOption danger={cancel} onClick={() => onPick('following')}
              label="This and later"
              sub="Earlier dates stay." />
            <ScopeOption danger={cancel} onClick={() => onPick('series')}
              label="All events"
              sub="Past and future." />
          </>
        ) : (
          <>
            <p className="m-muted" style={{ fontSize: '0.86rem', lineHeight: 1.5, margin: '2px 2px 4px' }}>
              Changes <strong>every occurrence</strong>.
            </p>
            <ScopeOption danger={cancel} onClick={() => onPick('series')}
              label="All events"
              sub="Every occurrence in the series." />
          </>
        )}
        <Btn full variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </SheetV3>
  )
}
