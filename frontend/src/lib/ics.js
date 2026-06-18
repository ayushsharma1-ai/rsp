// "Add to my personal calendar" — get a DIRECT add-event prompt (not a silent
// download) across devices:
//   • Android / desktop → open Google Calendar's prefilled add-event screen.
//   • iPhone / iPad      → open the .ics INLINE so iOS shows Apple Calendar's
//                          "Add Event" sheet (instead of saving a file).
//   • popup blocked / anything else → fall back to downloading the .ics.

const pad = (n) => String(n).padStart(2, '0')

// JS Date / ISO string → UTC basic format: 20260612T093000Z
function toICSDate(d) {
  const dt = new Date(d)
  return (
    `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}` +
    `T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}${pad(dt.getUTCSeconds())}Z`
  )
}

// Escape per RFC 5545 (backslash, semicolon, comma, newline).
function esc(s = '') {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function isIOS() {
  const ua = navigator.userAgent || ''
  // iPadOS 13+ reports as "Macintosh" but is touch-capable.
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)
}

// evt: { id, title, description, start, end, location }
export function eventToICS(evt) {
  const uid = `${evt.id || `${evt.start}-${evt.title}`}@rsp`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RSP//Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${esc(uid)}`,
    `DTSTAMP:${toICSDate(evt.start)}`,
    `DTSTART:${toICSDate(evt.start)}`,
    `DTEND:${toICSDate(evt.end)}`,
    `SUMMARY:${esc(evt.title || 'Event')}`,
    evt.description ? `DESCRIPTION:${esc(evt.description)}` : null,
    evt.location ? `LOCATION:${esc(evt.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean)
  return lines.join('\r\n')
}

// Google Calendar "template" URL — opens the add-event screen prefilled.
export function googleCalUrl(evt) {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: evt.title || 'Event',
    dates: `${toICSDate(evt.start)}/${toICSDate(evt.end)}`,
  })
  if (evt.description) p.set('details', evt.description)
  if (evt.location) p.set('location', evt.location)
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

// Last-resort: save the .ics file (user opens it manually).
export function downloadICS(evt) {
  const blob = new Blob([eventToICS(evt)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(evt.title || 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'event'}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Main entry — pick the method that gives a direct "add to calendar" prompt.
// Returns a short string describing what it did (handy for a snackbar message).
export function addToCalendar(evt) {
  if (isIOS()) {
    // Navigating to a text/calendar data URL makes iOS Safari offer "Add to Calendar".
    window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(eventToICS(evt))}`
    return 'ios'
  }
  // Android / desktop: open Google Calendar's prefilled add screen in a new tab.
  const w = window.open(googleCalUrl(evt), '_blank', 'noopener')
  if (!w) {                 // popup blocked → download the .ics so nothing is lost
    downloadICS(evt)
    return 'download'
  }
  return 'google'
}
