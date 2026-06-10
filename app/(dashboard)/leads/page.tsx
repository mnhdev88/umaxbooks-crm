import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { LeadsPageClient } from '@/components/leads/LeadsPageClient'
import { resolveRange } from '@/lib/report-range'

interface PageProps {
  searchParams: Promise<{ agent?: string; period?: string; from?: string; to?: string }>
}

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

export default async function LeadsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { agent: agentId, period = 'today', from, to } = await searchParams
  // A calendar range (from/to) wins over the legacy `period` presets.
  const hasRange = Boolean(from || to)
  const range = resolveRange(from, to)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // Supabase/PostgREST caps every response at 1000 rows by default, so we page
  // through the table in batches to load every lead (keeps counts accurate past 1000).
  const BATCH = 1000
  const leads: any[] = []
  for (let offset = 0; ; offset += BATCH) {
    const batchQuery = supabase
      .from('leads')
      .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)')
      .neq('status', 'Live')
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH - 1)

    if (profile?.role === 'developer') batchQuery.eq('status', 'Contacted')

    const { data: batch, error } = await batchQuery
    if (error || !batch || batch.length === 0) break
    leads.push(...batch)
    if (batch.length < BATCH) break
  }

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  let filteredLeads = (leads || []) as Lead[]
  let filterBanner: string | undefined

  if (agentId) {
    let addedQ = supabase
      .from('activity_logs')
      .select('lead_id')
      .eq('user_id', agentId)
      .eq('action', 'Lead Created')
      .not('lead_id', 'is', null)
    if (hasRange) {
      if (range.fromISO) addedQ = addedQ.gte('created_at', range.fromISO)
      if (range.toISO) addedQ = addedQ.lt('created_at', range.toISO)
    } else {
      const start = periodStart(period)
      if (start) addedQ = addedQ.gte('created_at', start)
    }
    const { data: addedLogs } = await addedQ
    const leadIds = new Set((addedLogs || []).map((l: any) => l.lead_id))
    filteredLeads = filteredLeads.filter(l => leadIds.has(l.id))

    const agentName = agents?.find(a => a.id === agentId)?.full_name || 'Agent'
    const periodLabel = hasRange ? range.label : (PERIOD_LABELS[period] || period)
    filterBanner = `Leads added by ${agentName} · ${periodLabel}`
  }

  return (
    <>
      <Header title="Lead Management" profile={profile as Profile} />
      <LeadsPageClient
        initialLeads={filteredLeads}
        agents={(agents || []) as Profile[]}
        profile={profile as Profile}
        userId={user.id}
        filterBanner={filterBanner}
      />
    </>
  )
}
