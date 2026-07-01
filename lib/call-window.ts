// Shared "can I call this lead right now?" logic, mirrored by the DB's
// lead_call_rank() (migration 072) so the live client badge and the server-side
// sort agree. The window defaults to 9:30am–8:00pm in the LEAD's local US zone;
// admins can tune it (app_settings.call_window_start / call_window_end). The
// 8pm cap keeps calls inside US TCPA legal hours (8am–9pm called-party time).

export const DEFAULT_CALL_WINDOW = { start: '09:30', end: '20:00' } as const

export type CallState = 'call' | 'early' | 'late' | 'unknown'

export interface CallStatus {
  state: CallState
  localTime: string     // e.g. "9:12 AM" (empty when zone unknown)
  label: string         // short badge text
  opensInMin: number    // minutes until the window opens (only when state === 'early')
}

// "HH:MM" → minutes since midnight. Returns null on malformed input.
function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function humanGap(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// Current wall-clock in a given IANA zone → { minutes since midnight, "9:12 AM" }.
function zoneNow(timeZone: string, now: Date): { minutes: number; display: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? 'NaN', 10)
  const h = get('hour') % 24
  const m = get('minute')
  const display = new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now)
  return { minutes: h * 60 + m, display }
}

export function getCallStatus(
  timeZone: string | null | undefined,
  windowStart: string,
  windowEnd: string,
  now: Date,
): CallStatus {
  if (!timeZone) {
    return { state: 'unknown', localTime: '', label: 'No zone', opensInMin: 0 }
  }

  const startM = parseHM(windowStart) ?? parseHM(DEFAULT_CALL_WINDOW.start)!
  const endM   = parseHM(windowEnd)   ?? parseHM(DEFAULT_CALL_WINDOW.end)!

  let minutes: number, display: string
  try {
    ({ minutes, display } = zoneNow(timeZone, now))
  } catch {
    return { state: 'unknown', localTime: '', label: 'No zone', opensInMin: 0 }
  }
  if (Number.isNaN(minutes)) {
    return { state: 'unknown', localTime: '', label: 'No zone', opensInMin: 0 }
  }

  if (minutes < startM) {
    const gap = startM - minutes
    return { state: 'early', localTime: display, label: `Opens in ${humanGap(gap)}`, opensInMin: gap }
  }
  if (minutes > endM) {
    return { state: 'late', localTime: display, label: 'After hours', opensInMin: 0 }
  }
  return { state: 'call', localTime: display, label: 'Call now', opensInMin: 0 }
}
