import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  acceptedLast4, sanitizeSections, shareLinkState, SHARE_LINK_DAYS,
} from '@/lib/share-link'

/**
 * Staff API behind the "Client Link" tab: generate, list and revoke the
 * no-login /share/<token> links a rep sends to a lead.
 *
 * Authenticated (this is NOT under /api/public) — the client-facing half lives
 * in /api/public/share/<token>/*. Writes go through the service client because
 * lead_share_links is service-role-write / staff-SELECT, the same shape as
 * sms_messages in migration 094.
 */

// Keep in step with the tab's role list and with /api/contracts: a role that
// can see the button and then gets a 403 is worse than not showing it.
const CAN_MANAGE = ['admin', 'sales_agent', 'sales_manager']

/** Public origin, resolved the same way /api/email/send does it (0.0.0.0 behind PM2). */
function publicOrigin(req: NextRequest): string {
  const fwdHost  = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''
  const fwdProto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https'
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
    || (fwdHost ? `${fwdProto}://${fwdHost}` : req.nextUrl.origin)
}

async function requireStaff() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!CAN_MANAGE.includes(profile?.role ?? '')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { userId: user.id }
}

export async function GET(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const leadId = req.nextUrl.searchParams.get('lead_id')
  if (!leadId) return NextResponse.json({ error: 'Missing lead_id' }, { status: 400 })

  const service = createServiceClient()

  const [{ data: links, error }, { data: lead }] = await Promise.all([
    service
      .from('lead_share_links')
      .select('id, token, sections, expires_at, revoked_at, view_count, last_viewed_at, locked_until, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    service
      .from('leads')
      .select('phone, whatsapp_number, alt_phones')
      .eq('id', leadId)
      .maybeSingle(),
  ])

  // Never swallow this — an unreadable list rendering as "no links yet" would
  // have a rep generate a second link for a client who already has one.
  if (error) {
    console.error('[lead-share] list failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const origin = publicOrigin(req)

  return NextResponse.json({
    // The digits the client will be asked for, so the rep can say them out loud
    // on the call instead of guessing which number we hold.
    accepted_last4: lead ? acceptedLast4(lead) : [],
    links: (links || []).map(l => ({
      ...l,
      url:   `${origin}/share/${l.token}`,
      state: shareLinkState(l),
    })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({}))
  const leadId = body.lead_id
  if (!leadId) return NextResponse.json({ error: 'Missing lead_id' }, { status: 400 })

  const sections = sanitizeSections(body.sections)
  if (sections.length === 0) {
    return NextResponse.json({ error: 'Pick at least one section to share' }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: lead } = await service
    .from('leads')
    .select('id, phone, whatsapp_number, alt_phones')
    .eq('id', leadId)
    .maybeSingle()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Without a phone number on file there is nothing for the client to type, so
  // the link would be a bare uuid with no second factor at all. Refuse it here
  // rather than silently downgrading the gate.
  if (acceptedLast4(lead).length === 0) {
    return NextResponse.json(
      { error: 'This lead has no phone number on file — add one first, or the link would have nothing to verify against.' },
      { status: 400 },
    )
  }

  const expires = new Date(Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: link, error } = await service
    .from('lead_share_links')
    .insert({ lead_id: leadId, sections, expires_at: expires, created_by: auth.userId })
    .select('id, token, sections, expires_at, revoked_at, view_count, last_viewed_at, created_at')
    .single()

  if (error) {
    console.error('[lead-share] create failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await service.from('activity_logs').insert({
    lead_id: leadId,
    user_id: auth.userId,
    action:  'Client Link Created',
    details: `Shared ${sections.join(', ')} — expires in ${SHARE_LINK_DAYS} days`,
  })

  return NextResponse.json({
    link: { ...link, url: `${publicOrigin(req)}/share/${link.token}`, state: 'active' },
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireStaff()
  if (auth.error) return auth.error

  const body = await req.json().catch(() => ({}))
  const { id, action } = body as { id?: string; action?: string }
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const service = createServiceClient()

  if (action === 'revoke') {
    const { data: link, error } = await service
      .from('lead_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .select('lead_id')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await service.from('activity_logs').insert({
      lead_id: link.lead_id,
      user_id: auth.userId,
      action:  'Client Link Revoked',
      details: 'The client link stopped working immediately',
    })

    return NextResponse.json({ ok: true })
  }

  if (action === 'unlock') {
    // A client who fat-fingered the digits five times shouldn't have to wait
    // out the lockout while a rep is on the phone with them.
    const { error } = await service
      .from('lead_share_links')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
