import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { DevQueueClient } from '@/components/developer/DevQueueClient'

export default async function DeveloperQueuePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const { data: leads } = await supabase
    .from('leads')
    .select(`
      *,
      assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name),
      audits(id, created_at, audit_short_pdf_url, audit_long_pdf_url, sitemap_pdf_url, tat_days, short_uploaded_at, agent_notes, developer_notes_short, developer_notes_long),
      demos(id, developer_id, temp_url, demo_version, upload_date, created_at, developer:profiles(full_name)),
      appointments(id, appointment_datetime, zoom_link, outcome_notes, client_requirements, created_at)
    `)
    .in('status', ['Demo Scheduled', 'Demo Done'])
    .order('updated_at', { ascending: false })

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  const processedLeads = (leads || []).map((lead: any) => ({
    ...lead,
    audits: (lead.audits || []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    demos: (lead.demos || []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
    appointments: (lead.appointments || []).sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ),
  }))

  return (
    <>
      <Header title="Developer Queue" profile={profile as Profile} />
      <DevQueueClient
        initialLeads={processedLeads as Lead[]}
        agents={(agents || []) as Profile[]}
        profile={profile as Profile}
        userId={user.id}
      />
    </>
  )
}
