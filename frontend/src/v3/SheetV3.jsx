import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useBackClose } from './useBackClose'

// Bottom sheet that collapses when you drag it down (slide finger back).
// Rendered through a portal to <body> so it always sits ABOVE the fixed tab bar
// on iOS Safari (where the in-tree version got painted under it). Drag starts
// from the grab-handle / header zone so the scrollable body still scrolls.
export default function SheetV3({ open, onClose, title, children }) {
  const [drag, setDrag] = useState(0)
  const startY = useRef(null)
  const sheetH = useRef(0)
  const ref = useRef(null)

  // device/browser back closes the sheet instead of leaving the page
  useBackClose(open, onClose)

  useEffect(() => {
    if (!open) { setDrag(0); return }
    // lock background scroll while the sheet is open (stops iOS rubber-banding)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && onClose && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  // Pointer events unify touch + mouse + pen. setPointerCapture keeps move/up
  // firing even when the cursor leaves the small grab handle — without it, a
  // MOUSE drag cancels the instant you slide off the handle (broke on desktop).
  const onStart = (e) => {
    startY.current = e.clientY
    sheetH.current = ref.current?.offsetHeight || 400
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    if (startY.current == null) return
    setDrag(Math.max(0, e.clientY - startY.current))
  }
  const onEnd = (e) => {
    if (startY.current == null) return
    e?.currentTarget?.releasePointerCapture?.(e.pointerId)
    const threshold = Math.min(140, sheetH.current * 0.32)
    if (drag > threshold) { startY.current = null; onClose && onClose() }
    else { setDrag(0); startY.current = null }
  }

  const backdropOpacity = Math.max(0, 0.5 - drag / 600)

  return ReactDOM.createPortal(
    <>
      <div className="m-sheet-backdrop" style={{ background: `rgba(0,0,0,${backdropOpacity})`, animation: drag ? 'none' : undefined }} onClick={onClose} />
      <div className="m-sheet" ref={ref} role="dialog" aria-modal="true"
        style={{ transform: `translateY(${drag}px)`, transition: startY.current == null ? 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1)' : 'none' }}>
        <div className="m-sheet__grab"
          onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd}>
          <div className="m-sheet__handle" />
          {title && <h3 className="m-sheet__title">{title}</h3>}
        </div>
        {children}
      </div>
    </>,
    document.body,
  )
}
