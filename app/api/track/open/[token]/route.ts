import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getRequestOrigin } from '@/lib/request-ip'

// 1x1 transparent GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

const HEADERS = {
  'Content-Type': 'image/gif',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

// Mail clients re-request the pixel as the reader scrolls, and Apple/Gmail prefetch it
// on delivery. Collapse repeat hits from the same origin inside this window so
// opened_count reflects real opens rather than client behaviour.
const DEDUPE_WINDOW_MS = 60_000

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const origin = getRequestOrigin(req.headers)

  try {
    const supabase = createServiceClient()
    const now = new Date().toISOString()

    const { data: record } = await supabase
      .from('email_tracking')
      .select('id, lead_id, first_opened_at, opened_count')
      .eq('token', token)
      .maybeSingle()

    if (record) {
      // Same token + same IP within the window → treat as one open already counted.
      const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
      let recentQuery = supabase
        .from('email_engagement_events')
        .select('id')
        .eq('token', token)
        .eq('event_type', 'open')
        .gte('created_at', since)
        .limit(1)
      // .is() and .eq() differ for NULL — an absent IP must match other absent IPs.
      recentQuery = origin.ip ? recentQuery.eq('ip', origin.ip) : recentQuery.is('ip', null)
      const { data: recent } = await recentQuery

      const isDuplicate = (recent?.length ?? 0) > 0

      if (!isDuplicate) {
        await supabase
          .from('email_tracking')
          .update({
            first_opened_at: record.first_opened_at ?? now,
            last_opened_at: now,
            opened_count: (record.opened_count ?? 0) + 1,
            // Summary columns feed the Email Status list without joining the event
            // log. Proxy opens still update them so the UI can show "location hidden"
            // rather than a stale real location from an earlier open.
            last_open_ip: origin.ip,
            last_open_is_proxy: origin.isProxy,
          })
          .eq('id', record.id)

        await supabase.from('email_engagement_events').insert({
          token,
          lead_id: record.lead_id,
          event_type: 'open',
          ip: origin.ip,
          user_agent: origin.userAgent,
          is_proxy: origin.isProxy,
          proxy_name: origin.proxyName,
        })
      }
    }
  } catch {
    // Never block the pixel response due to a DB error
  }

  return new NextResponse(GIF, { headers: HEADERS })
}
