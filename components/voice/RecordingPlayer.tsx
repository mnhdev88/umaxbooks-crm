'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

/**
 * Inline recording player. Twilio recordings are auth-protected, so they stream through
 * our /api/voice/twilio/recording proxy; Bland recordings are public and play directly.
 * The <audio> element is mounted on demand (preload="none") to avoid fetching every
 * recording when a long list of calls renders.
 */
export function RecordingPlayer({
  url,
  provider,
}: {
  url: string
  provider: string | null
}) {
  const [open, setOpen] = useState(false)
  const src =
    provider === 'twilio'
      ? `/api/voice/twilio/recording?url=${encodeURIComponent(url)}`
      : url

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
      >
        <Play size={12} /> Recording
      </button>
    )
  }
  return (
    <audio controls autoPlay preload="none" src={src} className="h-8 w-full max-w-xs">
      Your browser does not support audio playback.
    </audio>
  )
}
