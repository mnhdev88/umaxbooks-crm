import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { DevQueueClient } from '@/components/developer/DevQueueClient'

interface PageProps {
  searchParams: Promise<{ lead?: string; filter?: string }>
}

export default async function DeveloperQueuePage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { lead: initialLeadId, filter: initialFilter } = await searchParams

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

  // IDs of leads with an approved demo
  const { data: approvedApprovals } = await supabase
    .from('project_approvals')
    .select('lead_id')
    .eq('status', 'approved')

  const rawApprovedIds = [...new Set((approvedApprovals || []).map((a: any) => a.lead_id))]
  const newApprovedIds = rawApprovedIds.filter(id => !existingLeadIds.has(id))

  let approvedLeads: any[] = []
  if (newApprovedIds.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select(LEAD_SELECT)
      .in('id', newApprovedIds)
      .order('updated_at', { ascending: false })
    approvedLeads = processLeads(data || [])
  }

  // Leads with agent notes — status-independent, no FK join to avoid silent failures
  let agentNotesLeads: any[] = []
  let agentNotesLeadIds: string[] = []
  try {
    const { data: noteRows } = await supabase
      .from('audit_notes')
      .select('id, lead_id, note, created_at, user_id')
      .order('created_at', { ascending: true })

    if (noteRows?.length) {
      // Fetch author names separately to avoid FK join failures
      const authorIds = [...new Set(noteRows.map((n: any) => n.user_id).filter(Boolean))]
      const { data: authorProfiles } = authorIds.length
        ? await supabase.from('profiles').select('id, full_name').in('id', authorIds)
        : { data: [] }
      const authorMap = new Map((authorProfiles || []).map((p: any) => [p.id, p.full_name]))

      // Group notes by lead_id with author resolved
      const notesByLead = new Map<string, any[]>()
      for (const n of noteRows) {
        if (!notesByLead.has(n.lead_id)) notesByLead.set(n.lead_id, [])
        notesByLead.get(n.lead_id)!.push({
          ...n,
          author: { full_name: authorMap.get(n.user_id) ?? null },
        })
      }

      // Fetch leads with notes not already in allLeads (any pipeline status)
      const newLeadIds = [...notesByLead.keys()]
        .filter(id => !allLeads.some((l: any) => l.id === id))

      if (newLeadIds.length > 0) {
        const { data: notedLeadData } = await supabase
          .from('leads')
          .select(LEAD_SELECT)
          .in('id', newLeadIds)
          .order('updated_at', { ascending: false })
        agentNotesLeads = processLeads(notedLeadData || []).map((l: any) => ({
          ...l,
          audit_notes_list: notesByLead.get(l.id) || [],
        }))
      }

      // Attach notes to allLeads entries too
      for (const lead of allLeads) {
        if (notesByLead.has((lead as any).id)) {
          (lead as any).audit_notes_list = notesByLead.get((lead as any).id) || []
        }
      }

      // ALL leads with notes go into agentNotesLeadIds (badge + filter)
      agentNotesLeadIds = [...notesByLead.keys()].filter(id =>
        [...allLeads, ...agentNotesLeads].some((l: any) => l.id === id)
      )
    }
  } catch { /* audit_notes table not available */ }

  // Fetch Audit Ready leads that are NOT declined — these are agent-notified leads needing audit/proposal work
  const { data: auditReadyData } = await supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('status', 'Audit Ready')
    .order('updated_at', { ascending: false })

  const auditReadyLeads = processLeads(
    (auditReadyData || []).filter((l: any) => !rawDeclinedIds.includes(l.id))
  )

  const seenIds = new Set<string>()
  const allQueueLeads = [...allLeads, ...auditReadyLeads, ...agentNotesLeads, ...approvedLeads]
    .filter((l: any) => {
      if (seenIds.has(l.id)) return false
      seenIds.add(l.id)
      return true
    })
    .sort((a: any, b: any) =>
      new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime()
    )

  const auditReadyLeadIds = auditReadyLeads.map((l: any) => l.id)

  const approvedLeadIds = rawApprovedIds.filter(id =>
    allQueueLeads.some((l: any) => l.id === id)
  )

  // Fetch contact notes written by sales agents / agents for all leads in the queue
  try {
    const allQueueLeadIds = allQueueLeads.map((l: any) => l.id)
    if (allQueueLeadIds.length > 0) {
      const { data: salesNotes } = await supabase
        .from('lead_contact_notes')
        .select('id, lead_id, note, contact_date, created_at, author:profiles!user_id(full_name, role)')
        .in('lead_id', allQueueLeadIds)
        .order('created_at', { ascending: true })

      if (salesNotes?.length) {
        const notesByLead = new Map<string, any[]>()
        for (const n of salesNotes) {
          const role = (n.author as any)?.role
          if (role === 'sales_agent' || role === 'agent') {
            if (!notesByLead.has(n.lead_id)) notesByLead.set(n.lead_id, [])
            notesByLead.get(n.lead_id)!.push(n)
          }
        }
        for (const lead of allQueueLeads) {
          const notes = notesByLead.get((lead as any).id)
          if (notes?.length) {
            (lead as any).sales_notes_list = notes
            if (!agentNotesLeadIds.includes((lead as any).id)) {
              agentNotesLeadIds.push((lead as any).id)
            }
          }
        }
      }
    }
  } catch { /* silently skip if table unavailable */ }

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
        approvedLeadIds={approvedLeadIds}
        auditReadyLeadIds={auditReadyLeadIds}
        initialSelectedId={initialLeadId}
        initialFilter={initialFilter}
      />
    </>
  )
}
