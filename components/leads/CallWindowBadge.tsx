'use client'

import { useEffect, useState } from 'react'
import { Phone, PhoneOff, Clock } from 'lucide-react'
import { getCallStatus, type CallStatus } from '@/lib/call-window'

interface Props {
  timeZone: string | null | undefined // IANA zone derived from the lead's ZIP
  windowStart: string                 // "HH:MM"
  windowEnd: string                   // "HH:MM"
}

// Live per-row calling-window badge for the Leads list. Ticks every 30s so a
// lead flips from "Opens in 4m" to "Call now" without a page reload — the same
// self-refreshing approach as LocalTimeClock.
export function CallWindowBadge({ timeZone, windowStart, windowEnd }: Props) {
  const [status, setStatus] = useState<CallStatus | null>(null)

  useEffect(() => {
    const tick = () => setStatus(getCallStatus(timeZone, windowStart, windowEnd, new Date()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [timeZone, windowStart, windowEnd])

  // Avoid hydration mismatch — render nothing until the client clock starts.
  if (!status) return null

  if (status.state === 'unknown') {
    return <span className="text-slate-600 text-xs">—</span>
  }

  const cls =
    status.state === 'call' ? 'bg-green-900/40 text-green-400 border-green-800/40'
    : status.state === 'early' ? 'bg-amber-900/40 text-amber-400 border-amber-800/40'
    : 'bg-red-900/40 text-red-400 border-red-800/40'

  const Icon = status.state === 'call' ? Phone : status.state === 'early' ? Clock : PhoneOff

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border w-fit ${cls}`}>
        <Icon size={10} className="shrink-0" aria-hidden="true" />
        {status.label}
      </span>
      <span className="text-[10px] text-slate-500 pl-0.5">{status.localTime} local</span>
    </span>
  )
}
