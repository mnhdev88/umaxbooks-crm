import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  acceptedLast4, digitsOnly, gateLocked, shareLinkState,
  GATE_LOCK_MINUTES, MAX_GATE_ATTEMPTS, SHARE_SESSION_DAYS,
} from '@/lib/share-link'
import { issueShareCookie, shareCookieName } from '@/lib/share-cookie'

/**
 * POST /api/public/share/<token>/verify — the client types the last 4 digits of
 * their phone number to open a share link.
 *
 * No session: whitelisted from the auth redirect by the /api/public prefix in
 * proxy.ts. The uuid token is the secret; this check is the second factor, so
 * it is deliberately cheap to pass for the right person and expensive to guess:
 * MAX_GATE_ATTEMPTS wrong entries lock the LINK (not the IP) for
 * GATE_LOCK_MINUTES, counted on the row so a PM2 restart doesn't reset it.
 *
 * The response never says whether the token exists, only whether the digits
 * matched, so this can't be used to enumerate live links.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let body: { last4?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const entered = digitsOnly(body.last4).slice(-4)
  if (entered.length !== 4) {
    return NextResponse.json({ error: 'Enter the last 4 digits of your phone number.' }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: link } = await service
    .from('lead_share_links')
    .select('id, lead_id, failed_attempts, locked_until, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle()

  // Same generic answer for a bad token, a revoked link and an expired one —
  // the page itself already tells a legitimate visitor which of those it is.
  if (!link || shareLinkState(link) !== 'active') {
    return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 })
  }

  if (gateLocked(link)) {
    return NextResponse.json(
      { error: `Too many incorrect attempts. Try again in ${GATE_LOCK_MINUTES} minutes.` },
      { status: 429 },
    )
  }

  const { data: lead } = await service
    .from('leads')
    .select('phone, whatsapp_number, alt_phones')
    .eq('id', link.lead_id)
    .maybeSingle()

  const accepted = lead ? acceptedLast4(lead) : []

  if (!accepted.includes(entered)) {
    const attempts = (link.failed_attempts || 0) + 1
    const lock = attempts >= MAX_GATE_ATTEMPTS
      ? new Date(Date.now() + GATE_LOCK_MINUTES * 60 * 1000).toISOString()
      : null

    await service
      .from('lead_share_links')
      .update({ failed_attempts: attempts, locked_until: lock })
      .eq('id', link.id)

    return NextResponse.json(
      {
        error: lock
          ? `Too many incorrect attempts. Try again in ${GATE_LOCK_MINUTES} minutes.`
          : "That doesn't match the number we have on file.",
      },
      { status: lock ? 429 : 401 },
    )
  }

  // Correct: clear the brake so an earlier fat-fingered attempt can't lock the
  // client out on a later visit.
  await service
    .from('lead_share_links')
    .update({ failed_attempts: 0, locked_until: null })
    .eq('id', link.id)

  await service.from('lead_share_views').insert({
    link_id:    link.id,
    section:    'gate',
    ip:         req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null,
    user_agent: req.headers.get('user-agent'),
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(shareCookieName(token), issueShareCookie(token), {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     `/`,
    maxAge:   SHARE_SESSION_DAYS * 24 * 60 * 60,
  })
  return res
}
