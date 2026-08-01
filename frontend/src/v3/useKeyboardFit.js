import { useEffect, useRef } from 'react'
import { keyboardUp, visibleStrip } from './viewportKb'

// Keeps a FULL-PAGE form usable while the iOS keyboard is up.
//
// Why this is needed at all: iOS does not shrink the LAYOUT viewport when the
// keyboard opens — only the visual one. A page sized 100dvh therefore keeps its
// full height, and anything in its lower ~40% ends up behind the keyboard. iOS
// will happily scroll a focused input back into view, but only if some ancestor
// can actually scroll; `html, body { overflow: hidden }` (set globally so the
// fixed app shell can't rubber-band) means on the sign-in screen nothing can.
// Net effect on a real iPhone: you tap Password, the keyboard covers it, and no
// amount of dragging brings it back.
//
// Fix: while the keyboard is up, pin the element to the VISIBLE STRIP and let it
// scroll. The content is then taller than its box, so both iOS's own
// scroll-into-view and ours have somewhere to go. With no keyboard we put every
// property back exactly as we found it, so the stylesheet's own layout is untouched.
//
// PINNING, not just sizing — this is the part that was wrong twice. Clamping height
// assumes the element's top is the top of what you can see. It isn't: because nothing
// on the page can scroll, iOS offsets the whole visual viewport downward instead, so
// the visible strip starts partway down the layout viewport. An element left at top:0
// then straddles it. Measured on an emulated iPhone 14 with the height clamp alone, the
// password field sat at [309..357] against a strip starting at 336 — its top clipped.
// iPhone SE happened to pass, which is exactly how this survives review.
//
// position:fixed and NOT transform: a transformed ancestor becomes the containing block
// for `position: fixed` descendants, which would silently re-anchor anything fixed
// inside the element. `.v-app` is already position:fixed/inset:0, so this only changes
// the numbers, not the scheme.
//
// Sheets do NOT need this — SheetV3 anchors itself to the same strip.
// opts.scroll=false: don't add a scroller. Use for the app shell, which already
// has its own inner scroller (.v-content) and must not grow a second one.
export function useKeyboardFit({ scroll = true } = {}) {
  const ref = useRef(null)
  // The caller's own inline styles, captured once with the keyboard DOWN. Restoring the
  // exact original strings beats removing properties: LoginV3 sets minHeight inline,
  // and removing it would cost the page its full-height layout after the keyboard goes.
  const origin = useRef(null)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const PROPS = ['position', 'top', 'left', 'right', 'bottom', 'height', 'minHeight', 'overflowY']

    const fit = () => {
      const el = ref.current
      if (!el) return
      if (origin.current === null) {
        origin.current = {}
        for (const p of PROPS) origin.current[p] = el.style[p] || ''
      }
      if (keyboardUp()) {
        const strip = visibleStrip()
        el.style.position = 'fixed'
        el.style.top = `${strip.top}px`
        el.style.left = '0'
        el.style.right = '0'
        el.style.bottom = 'auto'
        el.style.height = `${strip.height}px`
        el.style.minHeight = '0px'
        if (scroll) el.style.overflowY = 'auto'
      } else {
        for (const p of PROPS) el.style[p] = origin.current[p]
      }
    }

    // Bring the focused field into the visible strip. The 300ms wait is the
    // keyboard animation — measuring sooner reads the pre-keyboard geometry.
    const onFocusIn = (e) => {
      if (!ref.current || !ref.current.contains(e.target)) return
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      setTimeout(() => {
        fit()
        try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { /* older WebKit */ }
      }, 300)
    }

    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
      document.removeEventListener('focusin', onFocusIn)
      const el = ref.current
      if (el && origin.current) for (const p of PROPS) el.style[p] = origin.current[p]
    }
  }, [scroll])

  return ref
}
