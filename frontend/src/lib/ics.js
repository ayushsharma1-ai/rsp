// Build and download an .ics (iCalendar) file for a single event.
// Tapping the downloaded file opens the device's native calendar app
// (Apple Calendar / Google Calendar / Outlook) pre-filled with the event,
// so the user adds it to their PERSONAL calendar in one or two taps.
// Pure client-side — no backend call, works offline.

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
