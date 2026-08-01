// "Add to my personal calendar":
//   • Android → fire the native ACTION_INSERT calendar intent via an `intent://`
//     URL. Chrome hands it to the OS, which opens the phone's calendar app on a
//     prefilled "new event" screen (the app chooser appears if several handle it).
//     No file, no browser. If nothing handles it, we fall back to the .ics.
//   • iOS / desktop → no web way to launch the native calendar app, so we save
//     the .ics (opening it hands off to Apple Calendar / the default app).
// (googleCalUrl is kept as an optional "add on the web" alternative if wanted.)

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

const isAndroid = () => /Android/i.test(navigator.userAgent || '')

// Android `intent://` URL that opens the calendar app's "new event" screen,
// prefilled. Uses CalendarContract's INSERT action + typed extras
// (l.=long ms, S.=string). Values are URL-encoded so ';' etc. don't break it.
function androidIntentUrl(evt) {
  const begin = new Date(evt.start).getTime()
  const end = new Date(evt.end).getTime()
  const body = [
    'action=android.intent.action.INSERT',
    'type=vnd.android.cursor.item/event',
    `l.beginTime=${begin}`,
    `l.endTime=${end}`,
    `S.title=${encodeURIComponent(evt.title || 'Event')}`,
    evt.location ? `S.eventLocation=${encodeURIComponent(evt.location)}` : null,
    evt.description ? `S.description=${encodeURIComponent(evt.description)}` : null,
  ].filter(Boolean).join(';')
  return `intent:#Intent;${body};end`
}

// evt: { id, title, description, start, end, location }
export function eventToICS(evt) {
  const uid = `${evt.id || `${evt.start}-${evt.title}`}@rsp`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Scheduler//Scheduler//EN',
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

// Main entry. Android → open the native calendar app directly; otherwise save
// the .ics. Returns a short tag so the caller can phrase its toast.
export function addToCalendar(evt) {
  if (isAndroid()) {
    // If the calendar app actually opens, this page goes to the background and
    // we cancel the fallback. If nothing handles the intent, save the .ics.
    const fallback = setTimeout(() => downloadICS(evt), 1500)
    document.addEventListener('visibilitychange', function onHide() {
      if (document.hidden) {
        clearTimeout(fallback)
        document.removeEventListener('visibilitychange', onHide)
      }
    })
    try {
      window.location.href = androidIntentUrl(evt)
    } catch (e) {
      clearTimeout(fallback)
      downloadICS(evt)
      return 'download'
    }
    return 'android'
  }
  downloadICS(evt)
  return 'download'
}
