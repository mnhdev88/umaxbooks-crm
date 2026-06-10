import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { EmailStatusClient } from '@/components/email/EmailStatusClient'

export default async function EmailStatusPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // For sales agents, scope to their assigned leads via an inner-joined `leads` embed
  // rather than pre-fetching lead ids and passing them to .in(...): an agent can own
  // hundreds of leads, and a few-hundred-UUID .in() list builds a multi-KB request URL
  // the API gateway rejects — the query then silently errors and the page shows nothing.
  const isSalesAgent = profile?.role === 'sales_agent'
  const leadEmbed = isSalesAgent
    ? 'lead:leads!inner(id, name, company_name, email, phone, assigned_agent_id)'
    : 'lead:leads(id, name, company_name, email, phone)'

  let sendsQuery = supabase
    .from('email_sends')
    .select(`
      id, lead_id, to_email, subject, html_body, status, sent_at, tracking_token, created_at,
      delivered_at, bounced_at, bounce_type, deferred_at, unsubscribed_at,
      click_count, first_clicked_at, last_clicked_url,
      sender:sent_by(full_name),
      ${leadEmbed}
    `)
    .neq('status', 'scheduled')
    .order('sent_at', { ascending: false })

  if (isSalesAgent) {
    sendsQuery = sendsQuery.eq('lead.assigned_agent_id', user.id)
  }

  const { data: sends, error: sendsErr } = await sendsQuery
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
