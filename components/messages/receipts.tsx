'use client'

import { Check, CheckCheck } from 'lucide-react'

export type Receipt = 'sent' | 'delivered' | 'seen'

// Receipt state for one of my sent messages, from the other person's markers.
export function receiptFor(createdAt: string, read: string | null, delivered: string | null): Receipt {
  const t = +new Date(createdAt)
  if (read && +new Date(read) >= t) return 'seen'
  if (delivered && +new Date(delivered) >= t) return 'delivered'
  return 'sent'
}

export function ReceiptTicks({ status, size = 13 }: { status: Receipt; size?: number }) {
  if (status === 'sent') return <Check size={size} className="text-slate-400" aria-label="Sent" />
  return (
    <CheckCheck
      size={size}
      className={status === 'seen' ? 'text-sky-400' : 'text-slate-400'}
      aria-label={status === 'seen' ? 'Seen' : 'Delivered'}
    />
  )
}
