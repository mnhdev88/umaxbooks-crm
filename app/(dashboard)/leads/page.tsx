import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { resolveRange } from '@/lib/report-range'

interface PageProps {
  searchParams: Promise<{
    agent?: string; period?: string; from?: string; to?: string
    q?: string; src?: string; status?: string; assignee?: string; state?: string
    tab?: string; page?: string; sort?: string
  }>
}

const PER_PAGE = 25

// Only the columns the list table / filters render. The edit modal fetches the
// full row on demand, so heavy text columns (notes, etc.) stay out of the list.
// `timezone` (generated from zip_code) powers the live call-window badge.
const LIST_COLUMNS =
  'id, name, company_name, lead_number, priority, source, city, website_url, ' +
  'gmb_review_rating, number_of_reviews, gmb_last_seen, status, timezone, ' +
  'assigned_agent_id, created_at, slug, ' +
  'assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)'

// Same columns off the leads_call_queue view (migration 072) for the "Call-ready
// first" sort: the view bakes the agent-name join in and adds call_rank, so we
// select a flat agent-name column instead of the PostgREST embed.
const VIEW_COLUMNS =
  'id, name, company_name, lead_number, priority, source, city, website_url, ' +
  'gmb_review_rating, number_of_reviews, gmb_last_seen, status, timezone, ' +
  'assigned_agent_id, created_at, slug, assigned_agent_name, call_rank'

function periodStart(period: string): string | null {
  const now = new Date()
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  if (period === '7d')    { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString() }
  if (period === '30d')   { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString() }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return null
}

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days', month: 'This Month', all: 'All Time',
}

// Strip characters that would break a PostgREST .or() filter list.
function sanitize(s: string) {
  return s.replace(/[,()*]/g, ' ').trim()
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const sp = await searchParams
  const { agent: agentId, period = 'today', from, to } = sp

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const role = profile?.role

  // ── Drill-down range (Reports → "leads added by agent in period") ──────────
  const hasRange = Boolean(from || to)
  const range = resolveRange(from, to)
  const drillFromISO = agentId ? (hasRange ? range.fromISO : periodStart(period)) : null
  const drillToISO   = agentId && hasRange ? range.toISO : null

  // ── In-table filters ───────────────────────────────────────────────────────
  const tab      = sp.tab || 'all'
  const search   = sp.q ? sanitize(sp.q) : ''
  const srcF     = sp.src || ''
  const statusF  = sp.status || ''
  const assignee = sp.assignee || ''
  const stateF   = sp.state || ''
  const page     = Math.max(1, parseInt(sp.page || '1', 10) || 1)
  // "Call-ready first": order by which leads it's currently inside the local
  // calling window for (see leads_call_queue / lead_call_rank in migration 072).
  const sortCallable = sp.sort === 'callable'

  // Applies the base scope shared by the list AND every stat count: role
  // constraints, the always-excluded "Live" status, and the Reports drill-down.
  const applyBase = (q: any) => {
    q = q.neq('status', 'Live')
    if (role === 'developer') q = q.eq('status', 'Contacted')
    if (agentId) {
      q = q.eq('created_by', agentId)
      if (drillFromISO) q = q.gte('created_at', drillFromISO)
      if (drillToISO)   q = q.lt('created_at', drillToISO)
    }
    return q
  }

  // Base scope + the active tab + the toolbar filters/search (drives the table).
  const applyView = (q: any) => {
    q = applyBase(q)
    if (tab === 'new')         q = q.eq('status', 'New')
    else if (tab === 'gmb')    q = q.eq('source', 'GMB')
    else if (tab === 'social') q = q.in('source', ['Facebook', 'LinkedIn'])
    else if (tab === 'other')  q = q.or('source.is.null,source.not.in.(GMB,Facebook,LinkedIn)')
    if (search) {
      const ors = [
        `name.ilike.*${search}*`,
        `company_name.ilike.*${search}*`,
        `city.ilike.*${search}*`,
        `website_url.ilike.*${search}*`,
        `phone.ilike.*${search}*`,
        `email.ilike.*${search}*`,
      ]
      if (/^\d+$/.test(search)) ors.push(`lead_number.eq.${search}`)
      q = q.or(ors.join(','))
    }
    if (srcF)     q = q.eq('source', srcF)
    if (statusF)  q = q.eq('status', statusF)
    if (assignee) q = q.eq('assigned_agent_id', assignee)
    if (stateF)   q = q.eq('state', stateF)
    return q
  }

  const fromRow = (page - 1) * PER_PAGE
  // The list query runs off the leads_call_queue view when sorting by call
  // readiness (adds call_rank + a flat agent-name column), else off leads.
  const listQuery = sortCallable
    ? applyView(supabase.from('leads_call_queue').select(VIEW_COLUMNS, { count: 'exact' }))
        .order('call_rank', { ascending: true })
        .order('created_at', { ascending: false })
        .range(fromRow, fromRow + PER_PAGE - 1)
    : applyView(supabase.from('leads').select(LIST_COLUMNS, { count: 'exact' }))
        .order('created_at', { ascending: false })
        .range(fromRow, fromRow + PER_PAGE - 1)

  const [
    pageRes, agentsRes, statesRes, windowRes, countsRes,
  ] = await Promise.all([
    listQuery,
    supabase.from('profiles').select('id, full_name, role, manager_id').in('role', ['agent', 'sales_agent', 'sales_manager', 'admin']).order('full_name'),
    supabase.rpc('distinct_lead_states'),
    supabase.from('app_settings').select('key, value').in('key', ['call_window_start', 'call_window_end']),
    // One conditional-aggregate scan instead of six count(*) round-trips; the
    // function mirrors applyBase() and runs SECURITY INVOKER, so RLS still applies.
    supabase.rpc('leads_tab_counts', {
      p_agent: agentId || null,
      p_from: drillFromISO,
      p_to: drillToISO,
    }).single(),
  ])

  // The view returns a flat assigned_agent_name; reshape it into the {full_name}
  // object the table already renders so LeadsPageClient needs no branching.
  const rawLeads = (pageRes.data || []) as any[]
  const leads = (sortCallable
    ? rawLeads.map(r => ({ ...r, assigned_agent: r.assigned_agent_name ? { full_name: r.assigned_agent_name } : null }))
    : rawLeads) as unknown as Lead[]

  const winMap = Object.fromEntries(((windowRes.data as { key: string; value: string }[] | null) || []).map(r => [r.key, r.value]))
  const callWindow = {
    start: winMap['call_window_start'] || '09:30',
    end:   winMap['call_window_end']   || '20:00',
  }
  const filteredCount = pageRes.count || 0
  const counts = countsRes.data as {
    total: number; new_ct: number; gmb: number
    demo: number; closed: number; social: number
  } | null
  const stats = {
    total:  counts?.total  ?? 0,
    newCt:  counts?.new_ct ?? 0,
    gmb:    counts?.gmb    ?? 0,
    demo:   counts?.demo   ?? 0,
    closed: counts?.closed ?? 0,
    social: counts?.social ?? 0,
  }
  const states = ((statesRes.data as { state: string }[] | null) || []).map(r => r.state)

  let filterBanner: string | undefined
  if (agentId) {
    const agentName = (agentsRes.data || []).find(a => a.id === agentId)?.full_name || 'Agent'
    const periodLabel = hasRange ? range.label : (PERIOD_LABELS[period] || period)
    filterBanner = `Leads added by ${agentName} · ${periodLabel}`
  }

  return (
    <>
      <Header title="Lead Management" profile={profile as Profile} />
      <LeadsPageClient
        leads={leads}
        stats={stats}
        states={states}
        totalCount={filteredCount}
        page={page}
        perPage={PER_PAGE}
        filters={{ tab, q: sp.q || '', src: srcF, status: statusF, assignee, state: stateF }}
        agents={(agentsRes.data || []) as unknown as Profile[]}
        profile={profile as Profile}
        userId={user.id}
        filterBanner={filterBanner}
        sortCallable={sortCallable}
        callWindow={callWindow}
      />
    </>
  )
}
