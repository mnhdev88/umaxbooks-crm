import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { AICallsClient, VoiceCallWithLead } from '@/components/voice/AICallsClient'
import { resolveReportingRange, DEFAULT_REPORT_TZ } from '@/lib/reporting-day'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function AICallsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { from, to } = await searchParams

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

  // Date range. The list below is capped at the most recent 500 calls, so a date
  // filter that only ran in the browser would quietly return nothing for anything
  // older than that window. When from/to are in the URL the whole query is scoped
  // to the range instead, and the client offers that as "Search all dates".
  //
  // Days are plain calendar days (midnight–midnight) in the business timezone —
  // NOT the 6am reporting-day boundary the Call Performance report uses. A date
  // picker that silently starts "Today" at 6am surprises people; reports keep
  // their own boundary. startHour: 0 is what makes resolveReportingRange do that.
  // business_timezone (099) is where the office is; report_timezone (074) is the
  // older reporting anchor it falls back to — same precedence as lib/business-hours.
  // Both keys are readable by any authenticated user, so this works for every role.
  const { data: tzRows } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', ['business_timezone', 'report_timezone'])
  const tzMap = new Map(
    ((tzRows || []) as { key: string; value: string | null }[]).map(r => [r.key, r.value?.trim()])
  )
  const tz = tzMap.get('business_timezone') || tzMap.get('report_timezone') || DEFAULT_REPORT_TZ
  const { fromISO, toISO, label } = resolveReportingRange(from, to, { tz, startHour: 0 })

  let query = supabase
    .from('voice_calls')
    .select(
      isSalesAgent
        ? '*, lead:leads!inner(id, name, company_name, lead_number, phone, assigned_agent_id)'
        : '*, lead:leads(id, name, company_name, lead_number, phone, assigned_agent_id)'
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (isSalesAgent) {
    query = query.eq('lead.assigned_agent_id', user.id)
  }
  // Half-open window: gte start, lt next-day start, so a call at 23:59:59 counts
  // for its own day and never leaks into the next one.
  if (fromISO) query = query.gte('created_at', fromISO)
  if (toISO)   query = query.lt('created_at', toISO)

  const { data: calls, error: callsErr } = await query
  if (callsErr) console.error('[ai-calls] voice_calls query failed:', callsErr)
  const rows = (calls || []) as VoiceCallWithLead[]

  // Summary counts come from the DATABASE, not from `rows`. Counting the fetched array
  // silently reported the .limit(500) above instead of reality — with ~1,900 calls the
  // tiles read "500 total / 0 AI", because every AI call is older than the 500th row.
  // head:true + count:'exact' transfers no rows, so this stays cheap and can't be
  // capped. Each count repeats the sales-agent scoping so an agent's tiles match their
  // list. Failures degrade to null and the tile falls back to counting `rows`.
  // The tiles carry the same date window as the list, so they never describe a
  // wider set of calls than the one being shown.
  const baseCount = () => {
    let q = supabase
      .from('voice_calls')
      .select(isSalesAgent ? 'id, leads!inner(assigned_agent_id)' : 'id', {
        count: 'exact',
        head: true,
      })
    if (isSalesAgent) q = q.eq('leads.assigned_agent_id', user.id)
    if (fromISO) q = q.gte('created_at', fromISO)
    if (toISO)   q = q.lt('created_at', toISO)
    return q
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

  // Attach the two names a call card can show: whoever was on the call (placed a dialer
  // call, or answered an inbound one) and the lead's owner. Those are the same person on
  // an outbound call, but a hunt-answered callback is by definition somebody else's lead.
  // The voice_calls.agent_user_id FK targets auth.users, so we map through profiles
  // ourselves rather than via a PostgREST embed; the owner rides along in the same read.
  const nameIds = [...new Set(
    rows.flatMap(c => [c.agent_user_id, c.lead?.assigned_agent_id]).filter(Boolean)
  )] as string[]
  if (nameIds.length) {
    const { data: named } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', nameIds)
    const byId = new Map((named || []).map((p: any) => [p.id, p.full_name as string | null]))
    for (const c of rows) {
      if (c.agent_user_id) c.agent = { full_name: byId.get(c.agent_user_id) ?? null }
      if (c.lead?.assigned_agent_id) c.owner = { full_name: byId.get(c.lead.assigned_agent_id) ?? null }
    }
  }

  return (
    <>
      <Header title="Calls" profile={profile as Profile} />
      <AICallsClient
        initialCalls={rows}
        stats={stats}
        dateRange={{ from, to, label, tz, applied: !!(fromISO || toISO) }}
      />
    </>
  )
}
