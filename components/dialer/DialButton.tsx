'use client'

import { useState } from 'react'
import { Phone } from 'lucide-react'
import { useDialer } from './DialerProvider'
import { PreCallModal } from '@/components/leads/PreCallModal'

/**
 * "Call" button for a lead — places a live browser call to the lead via the Twilio
 * softphone (distinct from the autonomous "AI Call" / Bland button next to it).
 *
 * Clicking opens a pre-call popup that shows the lead's last 5 calls; the agent then
 * confirms ("Call") to dial or flags the lead ("Do not call").
 */
export function DialButton({
  leadId,
  phone,
  name,
  altPhones,
}: {
  leadId: string
  phone?: string | null
  name?: string | null
  /** Additional numbers on file (leads.alt_phones) — offered as choices in the pre-call popup. */
  altPhones?: { value: string; label?: string }[] | null
}) {
  const { startCall, ready } = useDialer()
  const [open, setOpen] = useState(false)
  const hasNumber = Boolean(phone || altPhones?.length)
  const disabled = !hasNumber || !ready

  return (
    <>
      <button
        onClick={() => hasNumber && setOpen(true)}
        disabled={disabled}
        title={hasNumber ? 'Call this lead from your browser' : 'No phone number on file'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10
                   px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors
                   hover:bg-emerald-500/20 hover:text-emerald-200
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Phone size={13} />
        Call
      </button>

      <PreCallModal
        open={open}
        leadId={leadId}
        phone={phone}
        altPhones={altPhones}
        name={name}
        callType="dialer"
        onConfirm={(dialNumber, callerNumberId) =>
          dialNumber && startCall({ phone: dialNumber, leadId, name: name || undefined, callerNumberId })
        }
        onClose={() => setOpen(false)}
      />
    </>
  )
}
