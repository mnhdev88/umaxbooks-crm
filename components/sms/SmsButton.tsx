'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { SmsThreadModal } from './SmsThreadModal'

/**
 * "Text" button for a lead — opens the SMS conversation thread (send + received replies),
 * sitting next to the "Call" and "AI Call" buttons on the lead page. Unlike the dialer it
 * has no device to warm up: it's enabled whenever the lead has a number on file.
 */
export function SmsButton({
  leadId,
  phone,
  name,
  altPhones,
}: {
  leadId: string
  phone?: string | null
  name?: string | null
  /** Additional numbers on file (leads.alt_phones) — offered as recipient choices. */
  altPhones?: { value: string; label?: string }[] | null
}) {
  const [open, setOpen] = useState(false)
  const hasNumber = Boolean(phone || altPhones?.length)

  return (
    <>
      <button
        onClick={() => hasNumber && setOpen(true)}
        disabled={!hasNumber}
        title={hasNumber ? 'Text this lead' : 'No phone number on file'}
        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10
                   px-3 py-1.5 text-xs font-semibold text-sky-300 transition-colors
                   hover:bg-sky-500/20 hover:text-sky-200
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        <MessageSquare size={13} />
        Text
      </button>

      {open && (
        <SmsThreadModal
          leadId={leadId}
          phone={phone}
          altPhones={altPhones}
          name={name}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
