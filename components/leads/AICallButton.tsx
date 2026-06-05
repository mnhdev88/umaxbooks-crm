'use client'

import { useState } from 'react'
import { PhoneCall, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function AICallButton({ leadId, phone }: { leadId: string; phone?: string | null }) {
  const [loading, setLoading] = useState(false)

  const disabled = !phone || loading

  async function handleCall() {
    if (!phone) return
    const ok = window.confirm(
      `Place an AI voice call to ${phone}?\n\nThis dials the lead immediately and uses calling credits.`
    )
    if (!ok) return

    setLoading(true)
    try {
      const res = await fetch('/api/voice/call-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Call failed (${res.status})`)
      }
      toast.success('AI call placed — the lead is being dialed now.')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to place AI call.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleCall}
      disabled={disabled}
      title={phone ? 'Place an AI voice call to this lead' : 'No phone number on file'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-500/10
                 px-3 py-1.5 text-xs font-semibold text-orange-300 transition-colors
                 hover:bg-orange-500/20 hover:text-orange-200
                 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />}
      {loading ? 'Calling…' : 'AI Call'}
    </button>
  )
}
