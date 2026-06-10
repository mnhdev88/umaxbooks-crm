'use client'

import { Phone } from 'lucide-react'
import { useDialer } from './DialerProvider'

/**
 * "Call" button for a lead — places a live browser call to the lead via the Twilio
 * softphone (distinct from the autonomous "AI Call" / Bland button next to it).
 */
export function DialButton({
  leadId,
  phone,
  name,
}: {
  leadId: string
  phone?: string | null
  name?: string | null
}) {
  const { startCall, ready } = useDialer()
  const disabled = !phone || !ready

  return (
    <button
      onClick={() => phone && startCall({ phone, leadId, name: name || undefined })}
      disabled={disabled}
      title={phone ? 'Call this lead from your browser' : 'No phone number on file'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10
                 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors
                 hover:bg-emerald-500/20 hover:text-emerald-200
                 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Phone size={13} />
      Call
    </button>
  )
}
