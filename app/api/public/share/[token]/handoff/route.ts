import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SHARE_SESSION_DAYS, shareLinkState } from '@/lib/share-link'
import { issueShareCookie, shareCookieName } from '@/lib/share-cookie'

/**
 * GET /api/public/share/<token>/handoff?k=<key> — turn a one-time key from the
 * front door into the first-party access cookie, then redirect to the
 * documents.
 *
 * This is reached by a top-level NAVIGATION from data123.pages.dev, never by
 * fetch: that is the whole point. The cookie is written by crm.noveliotech.com
 * for crm.noveliotech.com, so no third-party cookie policy applies and the key
 * never has to travel back to the Pages origin.
 *
 * The key is single-use and lives 60 seconds, so a URL left in browser history,
 * a screenshot, or a shared screen is worthless a minute later.
 */
export const dynamic = 'force-dynamic'

function reject(origin: string, reason: string) {
  // Send them back to the front door rather than showing an API error page —
  // the client has no idea what a handoff key is.
  const url = new URL('/share/expired', origin)
  url.searchParams.set('reason', reason)
  return NextResponse.redirect(url, { status: 302 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const key = req.nextUrl.searchParams.get('k')
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin

  if (!key) return reject(origin, 'missing')

  const service = createServiceClient()

  const { data: handoff } = await service
    .from('share_handoffs')
    .select('id, link_id, expires_at, consumed_at')
    .eq('key', key)
    .maybeSingle()

  if (!handoff || handoff.consumed_at || Date.parse(handoff.expires_at) < Date.now()) {
    return reject(origin, 'expired')
  }

  const { data: link } = await service
    .from('lead_share_links')
    .select('id, token, expires_at, revoked_at')
    .eq('id', handoff.link_id)
    .maybeSingle()

  // The key is minted for one link; refuse if the URL names a different one.
  if (!link || link.token !== token || shareLinkState(link) !== 'active') {
    return reject(origin, 'unavailable')
  }

  // Burn it before issuing the cookie: a double-click that races here must not
  // hand out two sessions from one verification.
  const { data: burned } = await service
    .from('share_handoffs')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', handoff.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()

  if (!burned) return reject(origin, 'expired')

  await service.from('lead_share_views').insert({
    link_id:    link.id,
    section:    'gate',
    ip:         req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
    user_agent: req.headers.get('user-agent'),
  })

  const res = NextResponse.redirect(new URL(`/share/${token}`, origin), { status: 302 })
  res.cookies.set(shareCookieName(token), issueShareCookie(token), {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   SHARE_SESSION_DAYS * 24 * 60 * 60,
  })
  return res
}
