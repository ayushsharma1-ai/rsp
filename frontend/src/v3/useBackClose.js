import { useEffect, useRef } from 'react'

// Make the device/browser BACK button close the topmost open sheet/overlay
// instead of navigating away. Each open overlay registers here; while any are
// open we keep exactly one history "sentinel" entry, so a back press pops the
// sentinel (we close the top overlay) rather than a real route.
//
// Reconciliation is deferred to a microtask, so a rapid close+open in the same
// render (e.g. tapping "Edit" closes the detail sheet and opens the edit sheet)
// settles to the final stack state without a spurious close.
const stack = []          // refs to the current onClose fns, top = last
let armed = false         // is our sentinel currently in history?
let suppressPop = false   // ignore the next popstate (it was our own history.back)
let scheduled = false
let listening = false

function reconcileSoon() {
  if (scheduled) return
  scheduled = true
  Promise.resolve().then(() => {
    scheduled = false
    const want = stack.length > 0
    if (want && !armed) { window.history.pushState({ rspOverlay: 1 }, ''); armed = true }
    else if (!want && armed) { armed = false; suppressPop = true; window.history.back() }
  })
}

function onPop() {
  if (suppressPop) { suppressPop = false; return }
  if (!stack.length) return            // no overlay open → let the router handle back
  armed = false                        // the browser just consumed our sentinel
  const ref = stack[stack.length - 1]
  if (ref && ref.current) ref.current() // close the topmost overlay
  // its close sets open=false → effect cleanup removes it + reconciles (re-arms if more remain)
}

export function useBackClose(open, onClose) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!open) return
    if (!listening) { listening = true; window.addEventListener('popstate', onPop) }
    stack.push(ref)
    reconcileSoon()
    return () => {
      const i = stack.indexOf(ref)
      if (i >= 0) stack.splice(i, 1)
      reconcileSoon()
    }
  }, [open])
}
