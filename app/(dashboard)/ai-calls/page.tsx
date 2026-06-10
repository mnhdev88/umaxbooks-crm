import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { AICallsClient, VoiceCallWithLead } from '@/components/voice/AICallsClient'

export default async function AICallsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  // Sales agents only see calls for leads assigned to them (mirrors Email Status scoping).
  let leadIdFilter: string[] | null = null
  if (profile.role === 'sales_agent') {
    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('assigned_agent_id', user.id)
    leadIdFilter = (assignedLeads || []).map((l: any) => l.id)
  }

  if (leadIdFilter !== null && leadIdFilter.length === 0) {
    return (
      <>
        <Header title="Calls" profile={profile as Profile} />
        <AICallsClient initialCalls={[]} />
      </>
    )
  }

  let query = supabase
    .from('voice_calls')
    .select(`
      *,
      lead:leads(id, name, company_name, lead_number, phone)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (leadIdFilter !== null) {
    query = query.in('lead_id', leadIdFilter)
  }

  const { data: calls } = await query
  const rows = (calls || []) as VoiceCallWithLead[]

  // Attach the agent name for human dialer calls. The voice_calls.agent_user_id FK targets
  // auth.users, so we map through profiles ourselves rather than via a PostgREST embed.
  const agentIds = [...new Set(rows.map(c => c.agent_user_id).filter(Boolean))] as string[]
  if (agentIds.length) {
    const { data: agentProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', agentIds)
    const byId = new Map((agentProfiles || []).map((p: any) => [p.id, p.full_name as string | null]))
    for (const c of rows) {
      if (c.agent_user_id) c.agent = { full_name: byId.get(c.agent_user_id) ?? null }
    }
  }

  return (
    <>
      <Header title="Calls" profile={profile as Profile} />
      <AICallsClient initialCalls={rows} />
    </>
  )
}
