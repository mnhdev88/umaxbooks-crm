import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Engagement timeline for one sent email: every open and click with IP/client details.
//
// Fetched on demand by the Email Status drawer rather than loaded with the list — the
// list only needs the summary counters already on email_tracking, and pulling every
// event for every row would be a large payload for data that is usually not looked at.
//
// Uses the request-scoped (RLS-bound) client, not the service client: the SELECT policy
// on email_engagement_events limits reads to authenticated staff.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('email_engagement_events')
    .select('id, event_type, ip, user_agent, is_proxy, proxy_name, geo_city, geo_region, geo_country, clicked_url, created_at')
    .eq('token', token)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[email/engagement] query failed:', error)
    return NextResponse.json({ error: 'Failed to load engagement events' }, { status: 500 })
  }

  return NextResponse.json({ events: data || [] })
}
