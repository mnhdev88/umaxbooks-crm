import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SHARE_LINK_DAYS, SHARE_SECTIONS, shareLinkState } from '@/lib/share-link'
import {
  HANDOFF_TTL_SECONDS, MAX_LOOKUPS_PER_IP, RATE_WINDOW_MINUTES,
  corsHeaders, parseIdentifier,
} from '@/lib/client-portal'

/**
 * POST /api/public/client/open — the whole front door.
 *
 * A client types their phone number or email at nda123.pages.dev; we resolve it
 * to a lead and hand back a URL to their documents. No code, no second step —
 * see migration 113 for what that trades away and why it is deliberate.
 *
 * The returned URL is NOT the share page directly: it is a one-time handoff on
 * the CRM's own domain which sets the access cookie and redirects onward. That
 * indirection survives the removal of the code step because it solves a
 * different problem — the front door is on nda123.pages.dev and the documents
 * are on crm.noveliotech.com, and a cookie set by a cross-origin fetch is a
 * third-party cookie, which Safari and iOS block outright. A top-level
 * navigation carrying a single-use key writes the cookie first-party, by the
 * domain that will read it.
 *
 * Called cross-origin from the Pages site, so it answers CORS preflight and
 * echoes only allowlisted origins.
 */
export const dynamic = 'force-dynamic'

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'))
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors })

  let body: { identifier?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }

  const id = parseIdentifier(body.identifier)
  if (!id) {
    return json({ error: 'Enter your phone number (with area code) or your email address.' }, 400)
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null
  const service = createServiceClient()

  // The only brake left. Without the code step, this is what stands between a
  // list of business emails and a copy of everyone's pricing, so it is checked
  // before anything is resolved or written.
  if (ip) {
    const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
    const { count } = await service
      .from('share_lookups')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('created_at', since)

    if ((count || 0) >= MAX_LOOKUPS_PER_IP) {
      return json(
        { error: `Too many attempts. Please wait ${RATE_WINDOW_MINUTES} minutes and try again.` },
        429,
      )
    }
  }

  // Both resolvers are SECURITY DEFINER and service-role only; each returns an
  // id and never lead data (migrations 092 and 112).
  const { data: leadId } = id.kind === 'email'
    ? await service.rpc('lead_id_for_email', { p_email: id.value })
    : await service.rpc('lead_id_for_phone', { p_phone: id.value })

  // Logged whether or not it matched: a burst of misses from one address is
  // what scraping looks like, and only this table would show it.
  await service.from('share_lookups').insert({
    identifier: id.value,
    kind:       id.kind,
    lead_id:    leadId || null,
    ip,
    user_agent: req.headers.get('user-agent'),
  })

  if (!leadId) return json({ ok: true, found: false })

  // ── Find or create this lead's share link ─────────────────────────────────
  const { data: existing } = await service
    .from('lead_share_links')
    .select('id, token, sections, expires_at, revoked_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  let link = (existing || []).find(l => shareLinkState(l) === 'active') || null

  if (!link) {
    // A client at the front door should not hit a dead end because no rep has
    // generated a link yet. Sections default to all three; each renders its own
    // empty state, so this exposes no document that doesn't exist.
    const { data: created, error } = await service
      .from('lead_share_links')
      .insert({
        lead_id:    leadId,
        sections:   [...SHARE_SECTIONS],
        expires_at: new Date(Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id, token, sections, expires_at, revoked_at')
      .single()

    if (error || !created) {
      console.error('[client/open] link create failed:', error?.message)
      return json({ error: 'We could not open your documents. Please contact us.' }, 500)
    }

    link = created

    await service.from('activity_logs').insert({
      lead_id: leadId,
      action:  'Client Link Created',
      details: 'Created automatically when the client opened the front door',
    })
  }

  // ── Mint the handoff ──────────────────────────────────────────────────────
  const { data: handoff, error: handoffErr } = await service
    .from('share_handoffs')
    .insert({
      link_id:    link.id,
      expires_at: new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
      ip,
    })
    .select('key')
    .single()

  if (handoffErr || !handoff) {
    console.error('[client/open] handoff failed:', handoffErr?.message)
    return json({ error: 'We could not open your documents. Please contact us.' }, 500)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin

  return json({
    ok:    true,
    found: true,
    // Single-use, 60 seconds. Safe to put in a URL: it is worthless once used
    // and cannot be used to reach any other lead's documents.
    url:   `${origin}/api/public/share/${link.token}/handoff?k=${handoff.key}`,
  })
}
