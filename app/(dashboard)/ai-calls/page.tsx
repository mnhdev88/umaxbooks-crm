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
  // We scope by filtering through an inner-joined `leads` embed on assigned_agent_id,
  // NOT by pre-fetching the agent's lead ids and passing them to .in(...): an agent can
  // own hundreds of leads, and a few-hundred-UUID .in() list builds a multi-KB request
  // URL that the API gateway rejects — the query then silently errored and the page
  // showed zero calls (worked locally only because those agents had few leads).
  const isSalesAgent = profile.role === 'sales_agent'

  let query = supabase
    .from('voice_calls')
    .select(
      isSalesAgent
        ? '*, lead:leads!inner(id, name, company_name, lead_number, phone, assigned_agent_id)'
        : '*, lead:leads(id, name, company_name, lead_number, phone)'
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (isSalesAgent) {
    query = query.eq('lead.assigned_agent_id', user.id)
  }

  const { data: calls, error: callsErr } = await query
  if (callsErr) console.error('[ai-calls] voice_calls query failed:', callsErr)
  const rows = (calls || []) as VoiceCallWithLead[]

  // Summary counts come from the DATABASE, not from `rows`. Counting the fetched array
  // silently reported the .limit(500) above instead of reality — with ~1,900 calls the
  // tiles read "500 total / 0 AI", because every AI call is older than the 500th row.
  // head:true + count:'exact' transfers no rows, so this stays cheap and can't be
  // capped. Each count repeats the sales-agent scoping so an agent's tiles match their
  // list. Failures degrade to null and the tile falls back to counting `rows`.
  const baseCount = () => {
    const q = supabase
      .from('voice_calls')
      .select(isSalesAgent ? 'id, leads!inner(assigned_agent_id)' : 'id', {
        count: 'exact',
        head: true,
      })
    return isSalesAgent ? q.eq('leads.assigned_agent_id', user.id) : q
  }

  const [total, dialer, inbound, ai, interested, dnc] = await Promise.all([
    baseCount(),
    // Dialer excludes inbound: callbacks are provider='twilio' too, and counting them
    // here would double-count them against the Incoming tile.
    baseCount().eq('provider', 'twilio').neq('direction', 'inbound'),
    baseCount().eq('direction', 'inbound'),
    baseCount().neq('provider', 'twilio'),
    baseCount().in('interested', ['yes', 'maybe']),
    baseCount().eq('do_not_call', true),
  ])

  const isInbound = (c: VoiceCallWithLead) => c.direction === 'inbound'
  const stats = {
    total:      total.count      ?? rows.length,
    dialer:     dialer.count     ?? rows.filter(c => c.provider === 'twilio' && !isInbound(c)).length,
    inbound:    inbound.count    ?? rows.filter(isInbound).length,
    ai:         ai.count         ?? rows.filter(c => c.provider !== 'twilio').length,
    interested: interested.count ?? rows.filter(c => c.interested === 'yes' || c.interested === 'maybe').length,
    dnc:        dnc.count        ?? rows.filter(c => c.do_not_call).length,
  }

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
      <AICallsClient initialCalls={rows} stats={stats} />
    </>
  )
}
