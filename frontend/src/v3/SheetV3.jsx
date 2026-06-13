import React, { useEffect, useRef, useState } from 'react'

// Bottom sheet that collapses when you drag it down (slide finger back).
// Drag starts from the grab-handle / header zone so the scrollable body still
// scrolls normally. Release past the threshold closes; otherwise it snaps back.
export default function SheetV3({ open, onClose, title, children }) {
  const [drag, setDrag] = useState(0)
  const startY = useRef(null)
  const sheetH = useRef(0)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) { setDrag(0); return }
    const onKey = (e) => e.key === 'Escape' && onClose && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const onStart = (e) => {
    startY.current = (e.touches ? e.touches[0].clientY : e.clientY)
    sheetH.current = ref.current?.offsetHeight || 400
  }
  const onMove = (e) => {
    if (startY.current == null) return
    const y = (e.touches ? e.touches[0].clientY : e.clientY)
    setDrag(Math.max(0, y - startY.current))
  }
  const onEnd = () => {
    if (startY.current == null) return
    const threshold = Math.min(140, sheetH.current * 0.32)
    if (drag > threshold) { startY.current = null; onClose && onClose() }
    else { setDrag(0); startY.current = null }
  }

  const backdropOpacity = Math.max(0, 0.5 - drag / 600)

  return (
    <>
      <div className="m-sheet-backdrop" style={{ background: `rgba(0,0,0,${backdropOpacity})`, animation: drag ? 'none' : undefined }} onClick={onClose} />
      <div className="m-sheet" ref={ref} role="dialog" aria-modal="true"
        style={{ transform: `translateY(${drag}px)`, transition: startY.current == null ? 'transform 0.25s cubic-bezier(0.2,0.8,0.2,1)' : 'none' }}>
        <div className="m-sheet__grab"
          onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
          onMouseDown={onStart} onMouseMove={(e) => startY.current != null && onMove(e)} onMouseUp={onEnd} onMouseLeave={onEnd}>
          <div className="m-sheet__handle" />
          {title && <h3 className="m-sheet__title">{title}</h3>}
        </div>
        {children}
      </div>
    </>
  )
}
