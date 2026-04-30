import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { AuditFollowupClient } from '@/components/audits/AuditFollowupClient'

export default async function AuditsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  // Fetch relevant leads with their latest audit info
  const { data: leads } = await supabase
    .from('leads')
    .select(`
      *,
      assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name),
      audits(id, created_at, audit_short_pdf_url, audit_long_pdf_url, tat_days, short_uploaded_at)
    `)
    .in('status', ['Contacted', 'Audit Ready', 'Demo Scheduled', 'Demo Done', 'Revision', 'Live'])
    .order('updated_at', { ascending: false })

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  // Sort each lead's audits by created_at desc so audits[0] is the latest
  const leadsWithSortedAudits = (leads || []).map((lead: any) => ({
    ...lead,
    audits: (lead.audits || []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
  }))

  return (
    <>
      <Header title="Audit & Follow-up" profile={profile as Profile} />
      <AuditFollowupClient
        initialLeads={leadsWithSortedAudits as Lead[]}
        agents={(agents || []) as Profile[]}
        profile={profile as Profile}
        userId={user.id}
      />
    </>
  )
}
