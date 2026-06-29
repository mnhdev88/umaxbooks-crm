import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { resolveRange } from '@/lib/report-range'

interface PageProps {
  searchParams: Promise<{
    agent?: string; period?: string; from?: string; to?: string
    q?: string; src?: string; status?: string; assignee?: string; city?: string
    tab?: string; page?: string
  }>
}

const PER_PAGE = 25

// Only the columns the list table / filters render. The edit modal fetches the
// full row on demand, so heavy text columns (notes, etc.) stay out of the list.
const LIST_COLUMNS =
  'id, name, company_name, lead_number, priority, source, city, website_url, ' +
  'gmb_review_rating, number_of_reviews, gmb_last_seen, status, ' +
  'assigned_agent_id, created_at, slug, ' +
  'assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)'

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
  const cityF    = sp.city || ''
  const page     = Math.max(1, parseInt(sp.page || '1', 10) || 1)

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
    if (cityF)    q = q.eq('city', cityF)
    return q
  }

  const countBase = (extra?: (q: any) => any) => {
    let q = applyBase(supabase.from('leads').select('*', { count: 'exact', head: true }))
    if (extra) q = extra(q)
    return q
  }

  const fromRow = (page - 1) * PER_PAGE
  const [
    pageRes, agentsRes, citiesRes,
    totalRes, newRes, gmbRes, demoRes, closedRes, socialRes,
  ] = await Promise.all([
    applyView(supabase.from('leads').select(LIST_COLUMNS, { count: 'exact' }))
      .order('created_at', { ascending: false })
      .range(fromRow, fromRow + PER_PAGE - 1),
    supabase.from('profiles').select('id, full_name, role, manager_id').in('role', ['agent', 'sales_agent', 'sales_manager', 'admin']).order('full_name'),
    supabase.rpc('distinct_lead_cities'),
    countBase(),
    countBase(q => q.eq('status', 'New')),
    countBase(q => q.eq('source', 'GMB')),
    countBase(q => q.eq('status', 'Demo Scheduled')),
    countBase(q => q.eq('status', 'Closed Won')),
    countBase(q => q.in('source', ['Facebook', 'LinkedIn'])),
  ])

  const leads = (pageRes.data || []) as unknown as Lead[]
  const filteredCount = pageRes.count || 0
  const stats = {
    total:  totalRes.count || 0,
    newCt:  newRes.count || 0,
    gmb:    gmbRes.count || 0,
    demo:   demoRes.count || 0,
    closed: closedRes.count || 0,
    social: socialRes.count || 0,
  }
  const cities = ((citiesRes.data as { city: string }[] | null) || []).map(r => r.city)

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
        cities={cities}
        totalCount={filteredCount}
        page={page}
        perPage={PER_PAGE}
        filters={{ tab, q: sp.q || '', src: srcF, status: statusF, assignee, city: cityF }}
        agents={(agentsRes.data || []) as unknown as Profile[]}
        profile={profile as Profile}
        userId={user.id}
        filterBanner={filterBanner}
      />
    </>
  )
}
