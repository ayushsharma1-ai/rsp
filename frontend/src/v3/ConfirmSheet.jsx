import React, { useState, useCallback } from 'react'
import SheetV3 from './SheetV3'
import { Btn } from '../mobile/ui'

// In-app replacement for window.confirm. Browser confirm dialogs look like a
// system error, can't be styled, and put "OK" next to irreversible actions.
// This one names the action on the button, so nobody confirms blind.
//
//   const [confirm, confirmEl] = useConfirm()
//   ...render {confirmEl} once...
//   if (!(await confirm({ title, body, confirmLabel, danger: true }))) return
export function useConfirm() {
  const [req, setReq] = useState(null)          // {title, body, confirmLabel, cancelLabel, danger, resolve}
  const confirm = useCallback((opts) => new Promise(resolve => setReq({ ...opts, resolve })), [])
  const close = (ok) => { setReq(r => { r?.resolve(ok); return null }) }

  const confirmEl = (
    <SheetV3 open={!!req} onClose={() => close(false)} title={req?.title}>
      {req?.body && <p className="m-muted" style={{ margin: '0 0 4px', lineHeight: 1.55 }}>{req.body}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, marginTop: 12 }}>
        <Btn full variant="primary" onClick={() => close(true)}
          // danger: flat semantic red; --bg as text keeps contrast in both themes
          style={req?.danger ? { background: 'var(--danger)', color: 'var(--bg)', boxShadow: 'none' } : {}}>
          {req?.confirmLabel || 'Confirm'}
        </Btn>
        <Btn full variant="ghost" onClick={() => close(false)}>{req?.cancelLabel || 'Go back'}</Btn>
      </div>
    </SheetV3>
  )
  return [confirm, confirmEl]
}
