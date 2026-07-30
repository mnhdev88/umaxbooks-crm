import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getRequestOrigin } from '@/lib/request-ip'

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const destination = req.nextUrl.searchParams.get('url') || '/'

  // Validate destination is a real URL before redirecting
  let safeUrl: string
  try {
    const parsed = new URL(destination)
    // Only allow http/https destinations — block javascript: and data: URIs
    safeUrl = parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? destination
      : '/'
  } catch {
    safeUrl = '/'
  }

  const origin = getRequestOrigin(req.headers)

  try {
    const supabase = createServiceClient()
    const now = new Date().toISOString()

    const { data: send } = await supabase
      .from('email_sends')
      .select('id, lead_id, click_count, first_clicked_at')
      .eq('tracking_token', token)
      .maybeSingle()

    if (send) {
      await supabase
        .from('email_sends')
        .update({
          click_count:      (send.click_count || 0) + 1,
          first_clicked_at: send.first_clicked_at || now,
          last_clicked_url: safeUrl,
        })
        .eq('id', send.id)

      // Unlike an open, a click is fetched by the recipient's own browser, so this IP
      // is the real one — no proxy filtering needed and no dedupe (a repeat click is a
      // genuine repeat visit worth showing on the timeline).
      await supabase.from('email_engagement_events').insert({
        token,
        lead_id: send.lead_id,
        event_type: 'click',
        ip: origin.ip,
        user_agent: origin.userAgent,
        is_proxy: origin.isProxy,
        proxy_name: origin.proxyName,
        clicked_url: safeUrl,
      })
    }
  } catch {
    // Never block the redirect due to a DB error
  }

  return NextResponse.redirect(safeUrl, { status: 302 })
}
