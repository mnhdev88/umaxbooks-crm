'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceCall } from '@/types'

/**
 * `voice_calls` holds three kinds of row for a lead and they belong on different tabs:
 *   'ai'    — provider != 'twilio' (Bland AI agent)        → AI Calls tab
 *   'human' — provider = 'twilio' (dialer + inbound calls) → Calls & Appts tab
 * Splitting on provider rather than direction keeps inbound callbacks with the human
 * calls, which is where a rep expects to find them.
 */
export type LeadCallKind = 'ai' | 'human'

export function useLeadCalls(leadId: string, kind: LeadCallKind) {
  const [calls, setCalls] = useState<VoiceCall[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let active = true

    async function fetchCalls() {
      const query = supabase
        .from('voice_calls')
        .select('*')
        .eq('lead_id', leadId)
      // The owner is a property of the lead, not of any one call, so it's read alongside
      // rather than per row — an inbound call the team picked up now credits whoever
      // answered, and the card shows the owner separately.
      const [{ data }, { data: lead }] = await Promise.all([
        (kind === 'human'
          ? query.eq('provider', 'twilio')
          : query.neq('provider', 'twilio')
        ).order('created_at', { ascending: false }),
        supabase.from('leads').select('assigned_agent_id').eq('id', leadId).maybeSingle(),
      ])
      if (!active || !data) { if (active) setLoading(false); return }

      // Attach the staff names (FK targets auth.users, so we map through profiles
      // ourselves rather than relying on a PostgREST embed).
      const ownerId = (lead?.assigned_agent_id as string | null) ?? null
      const ids = [...new Set(
        [...data.map((c: VoiceCall) => c.agent_user_id), ownerId].filter(Boolean)
      )] as string[]
      let agents: Record<string, { full_name: string | null }> = {}
      if (ids.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids)
        agents = Object.fromEntries((profiles || []).map((p: any) => [p.id, { full_name: p.full_name }]))
      }
      const withAgents = (data as VoiceCall[]).map((c) => ({
        ...c,
        agent: c.agent_user_id ? agents[c.agent_user_id] ?? null : null,
        owner: ownerId ? agents[ownerId] ?? null : null,
      }))
      if (active) { setCalls(withAgents); setLoading(false) }
    }
    fetchCalls()

    // Live-update when a webhook or disposition saves a call. Postgres change filters
    // only take one condition, so we re-filter by provider in the fetch above.
    const channel = supabase
      .channel(`voice-calls-${kind}-${leadId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'voice_calls',
        filter: `lead_id=eq.${leadId}`,
      }, () => { fetchCalls() })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [leadId, kind])

  return { calls, loading }
}
