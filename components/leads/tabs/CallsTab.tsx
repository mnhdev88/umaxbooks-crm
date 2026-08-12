'use client'

import { CallCard } from '@/components/voice/CallCard'
import { useLeadCalls } from '@/components/voice/useLeadCalls'

interface CallsTabProps {
  leadId: string
}

/** AI (Bland) calls only — human dialer and inbound calls live on the Calls & Appts tab. */
export function CallsTab({ leadId }: CallsTabProps) {
  const { calls, loading } = useLeadCalls(leadId, 'ai')

  if (loading) {
    return <div className="text-center py-12 text-slate-500 text-sm">Loading calls…</div>
  }
  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        No AI calls yet. Use the “AI Call” button to reach this lead — results appear here.
        <br />
        Calls you place from the dialer show up under <span className="text-slate-400">Calls &amp; Appts</span>.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {calls.map(call => <CallCard key={call.id} call={call} />)}
    </div>
  )
}
