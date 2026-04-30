import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile, DealClosing } from '@/types'
import { DemoCloseClient } from '@/components/demo-close/DemoCloseClient'

export default async function DemoClosePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.role === 'agent' || profile.role === 'developer') redirect('/')

  // Leads where demo is built (Demo Scheduled / Demo Done) — not yet closed or lost
  const { data: leads } = await supabase
    .from('leads')
    .select(`
      *,
      assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name),
      audits(id, audit_short_pdf_url, audit_long_pdf_url, agent_notes, created_at),
      demos(id, temp_url, demo_version, created_at),
      appointments(id, appointment_datetime, zoom_link, outcome_notes, created_at),
      demo_approvals(id, status, auditor_id, auditor:profiles!demo_approvals_auditor_id_fkey(full_name), auditor_notes, reviewed_at),
      deal_closings(id, outcome, payment_type, token_amount, payment_method, services, start_date, end_date, client_phone, client_email, revision_notes, closing_call_notes, lost_reason, re_nurture_date, prep_checklist, closed_at)
    `)
    .in('status', ['Demo Scheduled', 'Demo Done', 'Closed Won', 'Lost'])
    .order('updated_at', { ascending: false })

  // Sort sub-arrays — latest first
  const processedLeads = (leads || []).map((lead: any) => ({
    ...lead,
    audits: (lead.audits || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    demos: (lead.demos || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    appointments: (lead.appointments || []).sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
  }))

  // Build lookup maps keyed by lead_id for before/after data
  const leadIds = processedLeads.map((l: any) => l.id)

  const { data: comparisons } = await supabase
    .from('before_after_comparisons')
    .select('*')
    .in('lead_id', leadIds.length > 0 ? leadIds : ['00000000-0000-0000-0000-000000000000'])

  const { data: metrics } = await supabase
    .from('before_after_metrics')
    .select('*')
    .in('lead_id', leadIds.length > 0 ? leadIds : ['00000000-0000-0000-0000-000000000000'])
    .order('sort_order')

  // closings map
  const closingsMap: Record<string, DealClosing> = {}
  processedLeads.forEach((lead: any) => {
    if (lead.deal_closings?.[0]) closingsMap[lead.id] = lead.deal_closings[0] as DealClosing
  })

  // comparisons map
  const comparisonsMap: Record<string, any> = {}
  ;(comparisons || []).forEach((c: any) => { comparisonsMap[c.lead_id] = c })

  // metrics map
  const metricsMap: Record<string, any[]> = {}
  ;(metrics || []).forEach((m: any) => {
    if (!metricsMap[m.lead_id]) metricsMap[m.lead_id] = []
    metricsMap[m.lead_id].push(m)
  })

  return (
    <>
      <Header title="Demo & Close" profile={profile as Profile} />
      <DemoCloseClient
        initialLeads={processedLeads as Lead[]}
        profile={profile as Profile}
        userId={user.id}
        initialClosings={closingsMap}
        initialComparisons={comparisonsMap}
        initialMetrics={metricsMap}
      />
    </>
  )
}
