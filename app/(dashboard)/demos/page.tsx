import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { DemosClient, DemoRow } from '@/components/demos/DemosClient'

export default async function DemosPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  // Base "agent" role has no Demo tab anywhere else — keep it out of here too.
  if (profile.role === 'agent') redirect('/')

  // All demos that carry a link, newest first. The `!inner` join on leads means
  // RLS naturally scopes this to leads the user can see (sales agents → their own
  // leads; admin/managers → everything).
  const { data: demos } = await supabase
    .from('demos')
    .select(`
      id, temp_url, demo_version, upload_date, created_at, lead_id,
      developer:profiles(full_name),
      lead:leads!inner(id, company_name, name, city, status,
        assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name))
    `)
    .not('temp_url', 'is', null)
    .order('created_at', { ascending: false })

  // Approval status is keyed by demo_url on project_approvals (same match the
  // per-lead Demo tab uses). Fetch once for all visible leads and map by url.
  const leadIds = Array.from(new Set((demos || []).map((d: any) => d.lead_id)))
  const { data: approvals } = leadIds.length
    ? await supabase
        .from('project_approvals')
        .select('lead_id, demo_url, status, revision_notes, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false })
    : { data: [] as any[] }

  const approvalByUrl: Record<string, any> = {}
  for (const a of approvals || []) {
    if (a.demo_url && !approvalByUrl[a.demo_url]) approvalByUrl[a.demo_url] = a
  }

  const rows: DemoRow[] = (demos || []).map((d: any) => {
    const approval = d.temp_url ? approvalByUrl[d.temp_url] : undefined
    return {
      id: d.id,
      leadId: d.lead_id,
      companyName: d.lead?.company_name ?? 'Unknown',
      contactName: d.lead?.name ?? null,
      city: d.lead?.city ?? null,
      leadStatus: d.lead?.status ?? null,
      agentId: d.lead?.assigned_agent?.id ?? null,
      agentName: d.lead?.assigned_agent?.full_name ?? null,
      developerName: d.developer?.full_name ?? null,
      tempUrl: d.temp_url as string,
      demoVersion: d.demo_version ?? null,
      uploadDate: d.upload_date ?? null,
      createdAt: d.created_at,
      approvalStatus: (approval?.status ?? null) as DemoRow['approvalStatus'],
      revisionNotes: approval?.revision_notes ?? null,
    }
  })

  return (
    <>
      <Header title="Demos" profile={profile as Profile} />
      <DemosClient rows={rows} role={profile.role} />
    </>
  )
}
