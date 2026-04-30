export interface TZInfo {
  tz: string
  abbr: string
  label: string
}

export const US_TIMEZONES: TZInfo[] = [
  { tz: 'America/New_York',    abbr: 'ET',  label: 'Eastern Time (ET)'  },
  { tz: 'America/Chicago',     abbr: 'CT',  label: 'Central Time (CT)'  },
  { tz: 'America/Denver',      abbr: 'MT',  label: 'Mountain Time (MT)' },
  { tz: 'America/Los_Angeles', abbr: 'PT',  label: 'Pacific Time (PT)'  },
  { tz: 'America/Anchorage',   abbr: 'AKT', label: 'Alaska Time (AKT)'  },
  { tz: 'Pacific/Honolulu',    abbr: 'HT',  label: 'Hawaii Time (HT)'   },
]

// Derive US timezone from 5-digit ZIP code using hardcoded prefix rules
export function getTimezoneFromZip(zip: string): TZInfo | null {
  if (!zip) return null
  const digits = zip.replace(/\D/g, '')
  if (!digits) return null

  const p3 = digits.substring(0, 3)
  if (['967', '968'].includes(p3))                       return US_TIMEZONES[5] // Hawaii
  if (['995','996','997','998','999'].includes(p3))       return US_TIMEZONES[4] // Alaska

  const d = parseInt(digits[0])
  if (d <= 4) return US_TIMEZONES[0] // Eastern  (0xx–4xx)
  if (d <= 7) return US_TIMEZONES[1] // Central  (5xx–7xx)
  if (d === 8) return US_TIMEZONES[2] // Mountain (8xx)
  return US_TIMEZONES[3]             // Pacific  (9xx)
}

// Convert a datetime-local input value (YYYY-MM-DDTHH:MM, interpreted as the given
// US timezone) to a UTC ISO string. Uses Intl to handle DST automatically.
export function localToUTC(localStr: string, tz: string): string {
  if (!localStr || !tz) return ''
  const [datePart, timePart] = localStr.split('T')
  if (!datePart || !timePart) return ''

  const [y, mo, d] = datePart.split('-').map(Number)
  const [h, m] = timePart.split(':').map(Number)

  // Treat the input values as UTC to create a reference point
  const refUTC = new Date(Date.UTC(y, mo - 1, d, h, m))

  // Find what local time refUTC corresponds to in the target timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(refUTC)
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0')

  const tzH = get('hour') % 24
  const tzM = get('minute')

  // offsetMin = how many minutes UTC is ahead of the timezone local time
  let offsetMin = (h - tzH) * 60 + (m - tzM)
  if (offsetMin >  720) offsetMin -= 1440
  if (offsetMin < -720) offsetMin += 1440

  return new Date(refUTC.getTime() + offsetMin * 60000).toISOString()
}

export interface DualTime {
  us: string       // e.g. "Mon, Jan 15 · 3:00 PM EST"
  ist: string      // e.g. "Tue, Jan 16 · 1:30 AM IST"
  nextDayIST: boolean
}

// Format a stored UTC ISO string into both US local time and IST for display
export function formatDualTime(isoStr: string, usTz: string, usAbbrFallback: string): DualTime {
  if (!isoStr) return { us: '', ist: '', nextDayIST: false }
  const d = new Date(isoStr)

  // Get the live abbreviation (EST vs EDT, PST vs PDT, etc.)
  let abbr = usAbbrFallback
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: usTz, timeZoneName: 'short' }).formatToParts(d)
    abbr = p.find(pt => pt.type === 'timeZoneName')?.value ?? usAbbrFallback
  } catch { /* use fallback */ }

  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }

  const us  = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: usTz }).format(d) + ' ' + abbr
  const ist = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'Asia/Kolkata' }).format(d) + ' IST'

  // en-CA locale produces YYYY-MM-DD — safe for string comparison
  const usDate  = new Intl.DateTimeFormat('en-CA', { timeZone: usTz }).format(d)
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)

  return { us, ist, nextDayIST: istDate > usDate }
}
