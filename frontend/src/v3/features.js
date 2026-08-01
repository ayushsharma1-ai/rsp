// UI feature switches.
//
// These hide a flow from the interface WITHOUT removing it. The backend keeps every
// route, the FSM keeps every transition, and the database keeps every column — so
// turning one back on is a one-line change here, not a re-implementation.

// ── Booking approvals ────────────────────────────────────────────────────────
// OFF since 2026-07-31 (owner's decision: no resource is meant to need sign-off yet).
//
// Verified against production before switching off, not assumed:
//   rooms with requires_approval AND is_active  → 0
//   bookings PENDING / APPROVED                 → 0 / 0
// so nothing was stranded by hiding the controls.
//
// What this switch does:
//   • hides the Pending / Approved / Rejected filters on the Bookings page — with no
//     resource requiring approval those three could only ever say "No pending
//     bookings", which is a filter that exists to return nothing
//   • hides Approve / Reject in the booking detail sheet
//   • hides the "Needs approval" checkbox on Add room / Edit room — this is the one
//     that matters. Leaving that tickable while the approve/reject controls are gone
//     is the actual trap: one tick and every booking for that room lands PENDING with
//     nothing anywhere in the app able to resolve it. The flag has to go with them.
//
// Turning it back on: set this to true. Nothing else needs touching. The "Needs
// approval" BADGE on the rooms list is deliberately NOT gated on this — if a room
// somehow carries the flag (set directly in SQL, or left over from before), that badge
// is the only visible sign, and hiding it would make the state invisible as well as
// unresolvable.
export const APPROVALS_ENABLED = false
