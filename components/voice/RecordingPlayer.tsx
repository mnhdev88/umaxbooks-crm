'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

/**
 * Inline recording player. Twilio recordings are auth-protected, so they stream through
 * our /api/voice/twilio/recording proxy; Bland recordings are public and play directly.
 * The <audio> element is mounted on demand to avoid fetching every recording when a long
 * list of calls renders — hence preload="metadata" rather than "none": by the time it
 * mounts the user has asked for it, and metadata is what gives the scrub bar its duration.
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
    // No forced height: the native control is ~54px in Chrome, and squashing it to h-8
    // clipped the internal layout so the timeline's hit area no longer matched where it
    // was drawn — clicks on the scrub bar landed nowhere.
    <audio controls autoPlay preload="metadata" src={src} className="w-full max-w-sm">
      Your browser does not support audio playback.
    </audio>
  )
}
