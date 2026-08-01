// The on-screen-keyboard geometry, in one place.
//
// Both SheetV3 and useKeyboardFit had their own copy of this arithmetic and both had
// the same bug, so it lives here now and is fixed once.
//
// THE BUG, because it is subtle and will look "obviously fine" to the next reader:
// the old inset was `innerHeight - visualViewport.height - visualViewport.offsetTop`.
// Subtracting offsetTop is wrong. iOS does not shrink the layout viewport for the
// keyboard — it shrinks the VISUAL viewport and then scrolls that smaller viewport
// DOWN inside the layout viewport to reveal whatever you focused. That scroll is
// exactly what offsetTop reports. So as the keyboard opened, offsetTop grew until the
// expression cancelled to 0 and the code concluded there was no keyboard, at the one
// moment there certainly was. This app makes it worse than a rare edge case:
// `html, body { overflow: hidden }` (v3.css) leaves iOS nothing to scroll except the
// visual viewport, so offsetTop is nonzero essentially every time.
//
// The two quantities are genuinely different and both are needed:
//   • HEIGHT of the keyboard  = innerHeight - vv.height          (offsetTop plays no part)
//   • WHERE the visible strip is = [vv.offsetTop, vv.offsetTop + vv.height]  (offsetTop added)

// A keyboard is hundreds of px tall. Safari's collapsing address bar moves the layout
// and visual viewports together so it nets out near zero, but keep headroom so a few
// px of subpixel rounding is never mistaken for a keyboard.
const KB_MIN = 80

export function keyboardInset() {
  const vv = window.visualViewport
  if (!vv) return 0
  return Math.max(0, window.innerHeight - vv.height)
}

export const keyboardUp = () => keyboardInset() > KB_MIN

// The visible strip in LAYOUT coordinates — the same coordinate space `position: fixed`
// resolves `top`/`bottom` against, so these values can be used directly.
export function visibleStrip() {
  const vv = window.visualViewport
  const h = window.innerHeight
  if (!vv) return { top: 0, bottom: h, height: h }
  const top = vv.offsetTop
  return { top, bottom: top + vv.height, height: vv.height }
}

// What a `position: fixed` element's `bottom` must be for its lower edge to land on the
// bottom of the visible strip. `bottom` is measured up from the LAYOUT viewport's floor,
// which is why this is a subtraction and not just `strip.bottom`.
export function fixedBottomForStrip() {
  return Math.max(0, window.innerHeight - visibleStrip().bottom)
}
