import React, { useEffect, useRef, useState, useReducer } from 'react'
import ReactDOM from 'react-dom'
import { useBackClose } from './useBackClose'
import { keyboardUp, visibleStrip, fixedBottomForStrip } from './viewportKb'

// ── Shared sheet stack ────────────────────────────────────────────────────────
// Each open sheet renders its OWN backdrop at rgba(0,0,0,0.5). When a confirm or
// scope sheet opens over an already-open sheet, the two 0.5 scrims composited to
// ~0.75 — visibly darker than intended, and it lightened back on dismiss. Fix: only
// the TOPMOST open sheet paints a backdrop. We track the open sheets in a module-
// level stack and notify mounted sheets when the stack changes so covered sheets
// hide their scrim. Exactly one 0.5 scrim is on screen no matter how many stack.
let sheetStack = []
const stackListeners = new Set()
const notifyStack = () => stackListeners.forEach((l) => l())
let sheetSeq = 0

export default function SheetV3({ open, onClose, title, children }) {
  const [drag, setDrag] = useState(0)
  const startY = useRef(null)
  const sheetH = useRef(0)
  const ref = useRef(null)
  const idRef = useRef(++sheetSeq)
  const [, forceUpdate] = useReducer((x) => x + 1, 0)

  // device/browser back closes the sheet instead of leaving the page
  useBackClose(open, onClose)

  // Register in the shared stack while open; re-render on any stack change so this
  // sheet knows whether it's still the topmost (and thus owns the single backdrop).
  useEffect(() => {
    if (!open) return
    const id = idRef.current
    const l = () => forceUpdate()
    stackListeners.add(l)
    sheetStack.push(id)
    notifyStack()
    return () => {
      stackListeners.delete(l)
      sheetStack = sheetStack.filter((x) => x !== id)
      notifyStack()
    }
  }, [open])

  // Covered = another sheet sits above this one in the stack. Before this sheet's
  // effect has pushed its id (first paint), indexOf is -1 → not covered → it shows
  // its backdrop, which is correct since a freshly-opened sheet is always on top.
  const myIdx = sheetStack.indexOf(idRef.current)
  const covered = myIdx !== -1 && myIdx < sheetStack.length - 1

  useEffect(() => {
    if (!open) { setDrag(0); return }
    // lock background scroll while the sheet is open (stops iOS rubber-banding)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && onClose && onClose()
    window.addEventListener('keydown', onKey)

    // iOS keyboard (audit, item 4): the on-screen keyboard shrinks only the
    // VISUAL viewport — dvh doesn't budge — so a bottom sheet sized 88dvh kept
    // its top half hidden behind the keyboard. Cap the sheet to the visual
    // viewport while it's open, and bring whichever field gets focused into the
    // visible part.
    const vv = window.visualViewport
    const clamp = () => {
      const el = ref.current
      if (!el || !vv) return
      // Anchor the sheet to the VISIBLE STRIP, not to the layout viewport.
      //
      // Capping the height alone was not enough: the sheet is position:fixed, so
      // `bottom: 0` resolves against the layout viewport, whose floor is behind the
      // keyboard. But the previous fix keyed off an inset that subtracted
      // visualViewport.offsetTop, and iOS scrolls the visual viewport down by roughly
      // the keyboard height to reveal the focused field — so that inset read 0 while
      // the keyboard was up, this branch was skipped, and the sheet kept its full
      // 88dvh with the title and first fields sitting ABOVE the visible strip,
      // off-screen. Measured on an emulated iPhone 14: visible [336..844], sheet
      // [101..844], focused input not visible. See viewportKb.js for the arithmetic.
      if (keyboardUp()) {
        const strip = visibleStrip()
        el.style.bottom = `${fixedBottomForStrip()}px`
        el.style.maxHeight = `${Math.max(220, strip.height - 12)}px`
      } else {
        // No keyboard: hand height back to the stylesheet (88dvh). Setting
        // maxHeight unconditionally here made EVERY sheet open 12px from the top
        // of the screen — on a notched iPhone the handle and title sat under the
        // status bar, and the backdrop shrank to a 12px strip nobody can tap to
        // dismiss. A bottom sheet has to stop short of the top to read as one.
        el.style.removeProperty('bottom')
        el.style.removeProperty('max-height')
      }
    }
    const onFocusIn = (e) => {
      if (!ref.current || !ref.current.contains(e.target)) return
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      // after the keyboard animation + our own re-layout
      setTimeout(() => { clamp(); try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* older WebKit */ } }, 300)
    }
    if (vv) {
      clamp()
      vv.addEventListener('resize', clamp)
      vv.addEventListener('scroll', clamp)   // iOS scrolls the visual viewport too
    }
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      if (vv) { vv.removeEventListener('resize', clamp); vv.removeEventListener('scroll', clamp) }
      document.removeEventListener('focusin', onFocusIn)
      if (ref.current) {
        ref.current.style.maxHeight = ''
        ref.current.style.removeProperty('bottom')
      }
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
      {/* Only the topmost sheet paints the scrim — otherwise stacked sheets would
          double-darken it. A covered sheet still renders (below), just without a scrim. */}
      {!covered && (
        <div className="m-sheet-backdrop" style={{ background: `rgba(0,0,0,${backdropOpacity})`, animation: drag ? 'none' : undefined }} onClick={onClose} />
      )}
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
