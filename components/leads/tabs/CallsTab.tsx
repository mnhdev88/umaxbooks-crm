'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceCall } from '@/types'
import { CallCard } from '@/components/voice/CallCard'

interface CallsTabProps {
  leadId: string
}

export function CallsTab({ leadId }: CallsTabProps) {
  const [calls, setCalls] = useState<VoiceCall[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let active = true

    async function fetchCalls() {
      const { data } = await supabase
        .from('voice_calls')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
      if (!active || !data) { if (active) setLoading(false); return }

      // Attach the agent name for human dialer calls (FK targets auth.users, so we map
      // through profiles ourselves rather than relying on a PostgREST embed).
      const agentIds = [...new Set(data.map((c: VoiceCall) => c.agent_user_id).filter(Boolean))] as string[]
      let agents: Record<string, { full_name: string | null }> = {}
      if (agentIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', agentIds)
        agents = Object.fromEntries((profiles || []).map((p: any) => [p.id, { full_name: p.full_name }]))
      }
      const withAgents = (data as VoiceCall[]).map((c) => ({
        ...c,
        agent: c.agent_user_id ? agents[c.agent_user_id] ?? null : null,
      }))
      if (active) { setCalls(withAgents); setLoading(false) }
    }
    fetchCalls()

    // Live-update when a webhook or disposition saves a call.
    const channel = supabase
      .channel(`voice-calls-${leadId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'voice_calls',
        filter: `lead_id=eq.${leadId}`,
      }, () => { fetchCalls() })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [leadId])

  if (loading) {
    return <div className="text-center py-12 text-slate-500 text-sm">Loading calls…</div>
  }
  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        No calls yet. Use the “Call” or “AI Call” button to reach this lead — results appear here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {calls.map(call => <CallCard key={call.id} call={call} />)}
    </div>
  )
}
