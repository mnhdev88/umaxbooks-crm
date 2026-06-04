'use client'

import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

interface Props {
  timeZone: string // IANA timezone, e.g. "America/Los_Angeles"
}

// Friendly region label per IANA zone (helps agents sanity-check border ZIPs).
const REGION_LABEL: Record<string, string> = {
  'America/New_York':    'Eastern',
  'America/Chicago':     'Central',
  'America/Denver':      'Mountain',
  'America/Phoenix':     'Arizona',
  'America/Los_Angeles': 'Pacific',
  'America/Anchorage':   'Alaska',
  'Pacific/Honolulu':    'Hawaii',
  'America/Puerto_Rico': 'Atlantic',
  'Pacific/Guam':        'Guam',
}

function format(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(new Date())

  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const time = `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.trim()
  const abbr = get('timeZoneName')

  // Local hour (0–23) for the business-hours indicator.
  const hour24 = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  )
  // Treat <8am or ≥9pm as a bad time to call.
  const offHours = Number.isNaN(hour24) ? false : hour24 < 8 || hour24 >= 21

  return { time, abbr, offHours }
}

export function LocalTimeClock({ timeZone }: Props) {
  const [now, setNow] = useState<{ time: string; abbr: string; offHours: boolean } | null>(null)

  useEffect(() => {
    const tick = () => setNow(format(timeZone))
    tick()
    const id = setInterval(tick, 30_000) // refresh every 30s
    return () => clearInterval(id)
  }, [timeZone])

  if (!now) {
    // Avoid hydration mismatch — render nothing until the client clock starts.
    return null
  }

  const region = REGION_LABEL[timeZone] || ''

  return (
    <div className="flex items-center gap-2 text-xs min-w-0">
      <Clock size={11} className={`flex-shrink-0 ${now.offHours ? 'text-red-400' : 'text-orange-400'}`} />
      <span className="text-slate-500 shrink-0">Local Time</span>
      <span className={`font-medium shrink-0 ${now.offHours ? 'text-red-400' : 'text-slate-200'}`}>
        {now.time} {now.abbr}
      </span>
      {region && <span className="text-slate-500 shrink-0">({region})</span>}
      {now.offHours && <span className="text-red-400/80 shrink-0">· off-hours</span>}
    </div>
  )
}
