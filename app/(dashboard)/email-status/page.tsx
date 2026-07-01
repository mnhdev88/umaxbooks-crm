import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { EmailStatusClient } from '@/components/email/EmailStatusClient'

const SELECT_COLS = `
  id, lead_id, to_email, subject, html_body, status, sent_at, tracking_token, created_at,
  delivered_at, bounced_at, bounce_type, deferred_at, unsubscribed_at,
  click_count, first_clicked_at, last_clicked_url,
  sender:sent_by(full_name),
  lead:leads(id, name, company_name, email, phone)
`

export default async function EmailStatusPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const role = profile?.role
  const isScoped = role === 'sales_agent' || role === 'sales_manager'

  // Admin / legacy agent: full visibility, one straightforward query.
  // Sales roles: scope to "emails I sent" ∪ "emails on leads I can see". The
  // lead-visibility half is expressed as an INNER embed on `leads`, whose own RLS
  // already limits rows to the right set (a sales_agent → their assigned leads; a
  // sales_manager → own + unassigned + their team, per migration 067). The
  // "emails I sent" half is a separate query on sent_by so a rep always sees mail
  // they personally sent even on a lead that isn't (or is no longer) assigned to
  // them — the case that was silently dropping their sent mail before.
  //
  // Two queries merged in memory rather than a single OR: PostgREST can't OR a
  // base-table filter (sent_by) with an embedded-table filter in one call, and a
  // pre-fetched .in(lead_ids) list would blow the request-URL length for a rep
  // who owns hundreds of leads (the query then silently errors → empty page).
  let sends: any[] = []
  let sendsErr: unknown = null

  if (isScoped) {
    const mineQuery = supabase
      .from('email_sends')
      .select(SELECT_COLS)
      .neq('status', 'scheduled')
      .eq('sent_by', user.id)

    let leadScopedQuery = supabase
      .from('email_sends')
      .select(SELECT_COLS.replace('lead:leads(', 'lead:leads!inner('))
      .neq('status', 'scheduled')

    // A sales_agent's leads RLS lets them see leads beyond their own assignment
    // (e.g. unassigned), so pin the lead half to leads actually assigned to them.
    // A sales_manager's leads RLS is already the team scope, so no extra filter.
    if (role === 'sales_agent') {
      leadScopedQuery = leadScopedQuery.eq('lead.assigned_agent_id', user.id)
    }

    const [mineRes, leadRes] = await Promise.all([mineQuery, leadScopedQuery])
    sendsErr = mineRes.error || leadRes.error

    const byId = new Map<string, any>()
    const merged: any[] = [...((mineRes.data as any[]) || []), ...((leadRes.data as any[]) || [])]
    for (const row of merged) {
      byId.set(row.id, row)
    }
    sends = [...byId.values()].sort((a, b) =>
      String(b.sent_at || b.created_at || '').localeCompare(String(a.sent_at || a.created_at || '')))
  } else {
    const res = await supabase
      .from('email_sends')
      .select(SELECT_COLS)
      .neq('status', 'scheduled')
      .order('sent_at', { ascending: false })
    sends = res.data || []
    sendsErr = res.error
  }

  if (sendsErr) console.error('[email-status] email_sends query failed:', sendsErr)

  const tokens = (sends || [])
    .map((s: any) => s.tracking_token)
    .filter(Boolean) as string[]

  let trackingMap: Record<string, {
    first_opened_at: string | null
    last_opened_at: string | null
    opened_count: number
  }> = {}

  if (tokens.length > 0) {
    const { data: trackingRows } = await supabase
      .from('email_tracking')
      .select('token, first_opened_at, last_opened_at, opened_count')
      .in('token', tokens)

    for (const row of (trackingRows || []) as any[]) {
      trackingMap[row.token] = row
    }
  }

  return (
    <>
      <Header title="Email Status" profile={profile as Profile} />
      <EmailStatusClient
        initialSends={(sends || []) as any[]}
        initialTrackingMap={trackingMap}
        userId={user.id}
      />
    </>
  )
}
