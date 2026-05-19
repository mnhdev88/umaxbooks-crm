import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { LeadsPageClient } from '@/components/leads/LeadsPageClient'

interface PageProps {
  searchParams: Promise<{ agent?: string; period?: string }>
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
  const { agent: agentId, period = 'today' } = await searchParams

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const leadsQuery = supabase
    .from('leads')
    .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)')
    .neq('status', 'Live')
    .order('created_at', { ascending: false })

  if (profile?.role === 'developer') leadsQuery.eq('status', 'Contacted')

  const { data: leads } = await leadsQuery

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  let filteredLeads = (leads || []) as Lead[]
  let filterBanner: string | undefined

  if (agentId) {
    const start = periodStart(period)
    let addedQ = supabase
      .from('activity_logs')
      .select('lead_id')
      .eq('user_id', agentId)
      .eq('action', 'Lead Created')
      .not('lead_id', 'is', null)
    if (start) addedQ = addedQ.gte('created_at', start)
    const { data: addedLogs } = await addedQ
    const leadIds = new Set((addedLogs || []).map((l: any) => l.lead_id))
    filteredLeads = filteredLeads.filter(l => leadIds.has(l.id))

    const agentName = agents?.find(a => a.id === agentId)?.full_name || 'Agent'
    filterBanner = `Leads added by ${agentName} · ${PERIOD_LABELS[period] || period}`
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
