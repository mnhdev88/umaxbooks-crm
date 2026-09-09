import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SHARE_LINK_DAYS, SHARE_SECTIONS, shareLinkState } from '@/lib/share-link'
import {
  HANDOFF_TTL_SECONDS, MAX_CODE_ATTEMPTS, codeMatches, corsHeaders, parseIdentifier,
} from '@/lib/client-portal'

/**
 * POST /api/public/client/verify-code — step 2 of the common front door.
 *
 * Checks the code, finds (or creates) this lead's share link, and returns a URL
 * the browser then navigates to. That URL is NOT the share page directly: it is
 * a one-time handoff on the CRM's own domain which sets the access cookie and
 * redirects onward.
 *
 * The indirection exists because the front door is on nda123.pages.dev and the
 * documents are on crm.noveliotech.com. A cookie set by a cross-origin fetch is
 * a third-party cookie, which Safari and iOS block outright — the client would
 * verify successfully and land on a page telling them they aren't verified. A
 * top-level navigation carrying a single-use key sidesteps that entirely: the
 * cookie is written first-party, by the domain that will read it.
 */
export const dynamic = 'force-dynamic'

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req.headers.get('origin'))
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: cors })

  let body: { identifier?: string; code?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request' }, 400)
  }

  // The same phone-or-email the code was requested with, normalised the same
  // way, so a client who typed their email in step 1 is looked up by it here.
  const id   = parseIdentifier(body.identifier)
  const code = String(body.code ?? '').replace(/\D/g, '')

  if (!id || code.length !== 6) {
    return json({ error: 'Enter the 6-digit code we sent you.' }, 400)
  }

  const service = createServiceClient()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || null

  // Newest live code for this identifier. Older ones are left to expire on
  // their own, so requesting a second code invalidates the first in practice
  // without a delete that would lose the audit trail.
  const { data: row } = await service
    .from('share_access_codes')
    .select('id, lead_id, code_hash, expires_at, attempts, consumed_at')
    .eq('identifier', id.value)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!row) {
    return json({ error: 'That code has expired. Please request a new one.' }, 401)
  }

  if ((row.attempts || 0) >= MAX_CODE_ATTEMPTS) {
    return json({ error: 'Too many incorrect attempts. Please request a new code.' }, 429)
  }

  if (!codeMatches(code, row.code_hash)) {
    await service
      .from('share_access_codes')
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq('id', row.id)

    const left = MAX_CODE_ATTEMPTS - (row.attempts || 0) - 1
    return json({
      error: left > 0
        ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : 'Too many incorrect attempts. Please request a new code.',
    }, 401)
  }

  // Correct. Burn the code so it cannot be replayed.
  await service
    .from('share_access_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)

  if (!row.lead_id) {
    return json({ error: 'We could not find your documents. Please contact us.' }, 404)
  }

  // ── Find or create this lead's share link ─────────────────────────────────
  const { data: existing } = await service
    .from('lead_share_links')
    .select('id, token, sections, expires_at, revoked_at')
    .eq('lead_id', row.lead_id)
    .order('created_at', { ascending: false })

  let link = (existing || []).find(l => shareLinkState(l) === 'active') || null

  if (!link) {
    // A client who verified their own phone or email should not hit a dead end
    // because no rep has generated a link yet. Sections default to all three;
    // each one renders its own friendly empty state when there is nothing in
    // it, so this exposes no document that doesn't exist.
    const { data: created, error } = await service
      .from('lead_share_links')
      .insert({
        lead_id:    row.lead_id,
        sections:   [...SHARE_SECTIONS],
        expires_at: new Date(Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id, token, sections, expires_at, revoked_at')
      .single()

    if (error || !created) {
      console.error('[client/verify-code] link create failed:', error?.message)
      return json({ error: 'We could not open your documents. Please contact us.' }, 500)
    }

    link = created

    await service.from('activity_logs').insert({
      lead_id: row.lead_id,
      action:  'Client Link Created',
      details: 'Created automatically when the client verified at the front door',
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
    console.error('[client/verify-code] handoff failed:', handoffErr?.message)
    return json({ error: 'We could not open your documents. Please contact us.' }, 500)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || req.nextUrl.origin

  return json({
    ok:  true,
    // Single-use, 60 seconds. Safe to put in a URL: it is worthless once used
    // and cannot be used to reach any other lead's documents.
    url: `${origin}/api/public/share/${link.token}/handoff?k=${handoff.key}`,
  })
}
