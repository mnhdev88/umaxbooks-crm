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

  const LEAD_SELECT = `
    *,
    assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name),
    audits(id, created_at, audit_short_pdf_url, audit_long_pdf_url, sitemap_pdf_url, tat_days, short_uploaded_at, agent_notes, developer_notes_short, developer_notes_long),
    demos(id, developer_id, temp_url, demo_version, upload_date, created_at, developer:profiles(full_name)),
    appointments(id, appointment_datetime, zoom_link, outcome_notes, client_requirements, created_at)
  `

  const { data: leads } = await supabase
    .from('leads')
    .select(LEAD_SELECT)
    .in('status', ['Demo Scheduled', 'Demo Done'])
    .order('updated_at', { ascending: false })

  // Also fetch leads that were declined (status = Audit Ready + have a declined approval)
  const { data: declinedApprovals } = await supabase
    .from('project_approvals')
    .select('lead_id')
    .eq('status', 'declined')

  const existingLeadIds = new Set((leads || []).map((l: any) => l.id))
  const rawDeclinedIds = [...new Set((declinedApprovals || []).map((a: any) => a.lead_id))]
  const newDeclinedIds = rawDeclinedIds.filter(id => !existingLeadIds.has(id))

  let declinedLeads: any[] = []
  if (newDeclinedIds.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .in('id', newDeclinedIds)
      .eq('status', 'Audit Ready')
      .order('updated_at', { ascending: false })
    declinedLeads = data || []
  }

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  const processLeads = (list: any[]) => list.map((lead: any) => ({
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

  const allLeads = [...processLeads(leads || []), ...processLeads(declinedLeads)]

  // IDs of leads currently in "Audit Ready" that have a declined approval
  const declinedLeadIds = allLeads
    .filter((l: any) => rawDeclinedIds.includes(l.id) && l.status === 'Audit Ready')
    .map((l: any) => l.id)

  // Leads with agent notes (from audit_notes thread table — migration 023)
  let agentNotesLeads: any[] = []
  let agentNotesLeadIds: string[] = []
  try {
    const { data: noteLeads, error: noteErr } = await supabase
      .from('audit_notes')
      .select('lead_id, note, created_at, author:profiles!audit_notes_user_id_fkey(full_name)')
      .order('created_at', { ascending: true })

    if (!noteErr && noteLeads?.length) {
      // Group notes by lead_id
      const notesByLead = new Map<string, any[]>()
      for (const n of noteLeads) {
        if (!notesByLead.has(n.lead_id)) notesByLead.set(n.lead_id, [])
        notesByLead.get(n.lead_id)!.push(n)
      }

      const notedLeadIds = [...notesByLead.keys()]
        .filter(id => !allLeads.some((l: any) => l.id === id))

      if (notedLeadIds.length > 0) {
        const { data: notedLeadData } = await supabase
          .from('leads')
          .select(LEAD_SELECT)
          .in('id', notedLeadIds)
          .order('updated_at', { ascending: false })
        agentNotesLeads = processLeads(notedLeadData || []).map((l: any) => ({
          ...l,
          audit_notes_list: notesByLead.get(l.id) || [],
        }))
        agentNotesLeadIds = agentNotesLeads.map((l: any) => l.id)
      }

      // Attach notes to existing leads too
      for (const lead of allLeads) {
        if (notesByLead.has((lead as any).id)) {
          (lead as any).audit_notes_list = notesByLead.get((lead as any).id) || []
        }
      }
    }
  } catch { /* migration 023 not yet applied — silently skip */ }

  const allQueueLeads = [...allLeads, ...agentNotesLeads]

  return (
    <>
      <Header title="Developer Queue" profile={profile as Profile} />
      <DevQueueClient
        initialLeads={allQueueLeads as Lead[]}
        agents={(agents || []) as Profile[]}
        profile={profile as Profile}
        userId={user.id}
        declinedLeadIds={declinedLeadIds}
        agentNotesLeadIds={agentNotesLeadIds}
      />
    </>
  )
}
