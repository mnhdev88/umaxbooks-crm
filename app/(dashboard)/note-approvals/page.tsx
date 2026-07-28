import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { NoteApprovalsClient, type NoteApproval } from '@/components/admin/NoteApprovalsClient'

export default async function NoteApprovalsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'sales_manager')) redirect('/')

  // Every note a sales agent submitted — the request rows. Manager replies are
  // pulled separately below and attached to the request they answered.
  const { data: rows } = await supabase
    .from('audit_notes')
    .select(`
      id, lead_id, note, created_at, approval_status, decline_reason, reviewed_at, source_note_id,
      author:profiles!audit_notes_user_id_fkey(id, full_name, role),
      reviewer:profiles!audit_notes_reviewed_by_fkey(full_name),
      lead:leads(id, company_name, name, slug, status, website_url)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  const all = (rows || []) as any[]

  // A sales manager only reviews their own team's agents; admins see everything.
  let teamIds: Set<string> | null = null
  if (profile.role === 'sales_manager') {
    const { data: team } = await supabase
      .from('profiles').select('id').eq('manager_id', user.id)
    teamIds = new Set((team || []).map((t: any) => t.id))
  }

  // The manager note that answered each request, keyed by the request's id.
  const replyBySource = new Map<string, string>()
  for (const r of all) {
    if (r.source_note_id) replyBySource.set(r.source_note_id, r.note)
  }

  const approvals: NoteApproval[] = all
    // Only agent-submitted requests are reviewable — skip manager/dev notes.
    .filter(r => r.author?.role === 'sales_agent')
    // Managers with an unassigned team still see unclaimed agents' notes.
    .filter(r => !teamIds || teamIds.size === 0 || teamIds.has(r.author?.id))
    .map(r => ({
      id: r.id,
      lead_id: r.lead_id,
      note: r.note,
      created_at: r.created_at,
      approval_status: (r.approval_status ?? 'approved') as NoteApproval['approval_status'],
      decline_reason: r.decline_reason ?? null,
      reviewed_at: r.reviewed_at ?? null,
      author: r.author ?? null,
      reviewer: r.reviewer ?? null,
      lead: r.lead ?? null,
      manager_note: replyBySource.get(r.id) ?? null,
    }))

  return (
    <>
      <Header title="Agent Note Approvals" profile={profile as Profile} />
      <NoteApprovalsClient initialApprovals={approvals} userId={user.id} />
    </>
  )
}
