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

  // For sales agents, scope to leads they are assigned to
  let leadIdFilter: string[] | null = null
  if (profile?.role === 'sales_agent') {
    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('assigned_agent_id', user.id)
    leadIdFilter = (assignedLeads || []).map((l: any) => l.id)
  }

  let sendsQuery = supabase
    .from('email_sends')
    .select(`
      id, lead_id, to_email, subject, status, sent_at, tracking_token, created_at,
      sender:sent_by(full_name),
      lead:leads(id, name, company_name, email, phone)
    `)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })

  if (leadIdFilter !== null) {
    if (leadIdFilter.length === 0) {
      // Agent has no assigned leads — return empty
      return (
        <>
          <Header title="Email Status" profile={profile as Profile} />
          <EmailStatusClient initialSends={[]} initialTrackingMap={{}} userId={user.id} />
        </>
      )
    }
    sendsQuery = sendsQuery.in('lead_id', leadIdFilter)
  }

  const { data: sends } = await sendsQuery

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
