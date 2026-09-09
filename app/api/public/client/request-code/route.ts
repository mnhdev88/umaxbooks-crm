import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { accessCodeEmail, sendSystemEmail } from '@/lib/system-email'
import { sendSms, smsFromNumber, toE164US } from '@/lib/voice/twilio'
import {
  CODE_TTL_MINUTES, MAX_CODES_PER_IP, MAX_CODES_PER_PHONE, RATE_WINDOW_MINUTES,
  corsHeaders, generateCode, hashCode, maskEmail, maskPhone, parseIdentifier,
} from '@/lib/client-portal'

/**
 * POST /api/public/client/request-code — step 1 of the common front door.
 *
 * The client types their phone number OR their email on data123.pages.dev; we
 * resolve either to a lead, mint a 6-digit code, and send it to EVERY contact
 * detail we hold for them — the email address and the phone number both, not
 * just the one they typed. A client who remembers their email but reads texts
 * faster shouldn't have to guess which one we prefer.
 *
 * Called cross-origin from the Pages site, so it answers CORS preflight and
 * echoes only allowlisted origins.
 *
 * Email is listed first on purpose: Twilio SMS to US numbers needs A2P 10DLC
 * registration, which isn't complete, so a code that only went by SMS would
 * silently never arrive.
 *
 * Enumeration: the masked destinations are only returned for someone we hold,
 * which does confirm "this person is a client of yours" to anyone who guesses a
 * number or address. That is a deliberate trade for a real client being able to
 * see WHERE their code went — held in check by a hard per-IP cap, which makes
 * walking the space useless while costing a real client nothing.
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
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()

  // Two brakes: one so a client can't be spammed with codes by someone who
  // knows their details, one so nobody can walk the space from a single machine
  // looking for who is a client. Counted on the normalised identifier, so
  // asking by phone and then by email doesn't double the allowance.
  const [{ count: byIdentifier }, { count: byIp }] = await Promise.all([
    service.from('share_access_codes')
      .select('id', { count: 'exact', head: true })
      .eq('identifier', id.value)
      .gte('created_at', since),
    ip
      ? service.from('share_access_codes')
          .select('id', { count: 'exact', head: true })
          .eq('ip', ip)
          .gte('created_at', since)
      : Promise.resolve({ count: 0 } as { count: number }),
  ])

  if ((byIdentifier || 0) >= MAX_CODES_PER_PHONE || (byIp || 0) >= MAX_CODES_PER_IP) {
    return json(
      { error: `Too many requests. Please wait ${RATE_WINDOW_MINUTES} minutes and try again.` },
      429,
    )
  }

  // Both resolvers are SECURITY DEFINER and service-role only; each returns an
  // id and never lead data (migrations 092 and 112).
  const { data: leadId } = id.kind === 'email'
    ? await service.rpc('lead_id_for_email', { p_email: id.value })
    : await service.rpc('lead_id_for_phone', { p_phone: id.value })

  if (!leadId) {
    return json({ ok: true, found: false })
  }

  const { data: lead } = await service
    .from('leads')
    .select('id, company_name, email, phone, whatsapp_number')
    .eq('id', leadId)
    .maybeSingle()

  const code = generateCode()
  const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString()

  // ── Deliver to everything we have ─────────────────────────────────────────
  const sent: { channel: 'email' | 'sms'; destination: string }[] = []

  if (lead?.email) {
    const { subject, html } = accessCodeEmail(code, lead.company_name)
    const result = await sendSystemEmail(service, { to: lead.email, subject, html })
    if (result.ok) sent.push({ channel: 'email', destination: maskEmail(lead.email) })
    else console.error('[client/request-code] email failed:', result.error)
  }

  const smsTo = lead?.phone || lead?.whatsapp_number
  const from  = smsFromNumber()
  if (smsTo && from) {
    try {
      await sendSms({
        to:   toE164US(smsTo),
        from,
        body: `${code} is your Noveliotech access code. It expires in ${CODE_TTL_MINUTES} minutes.`,
      })
      sent.push({ channel: 'sms', destination: maskPhone(smsTo) })
    } catch (e) {
      console.error('[client/request-code] sms failed:', e instanceof Error ? e.message : e)
    }
  }

  if (sent.length === 0) {
    // We know who they are but have no working way to reach them. Say so
    // plainly rather than leaving them waiting for a code that can't arrive.
    return json({
      ok: false,
      error: 'We could not send your code. Please contact us at support@noveliotech.com.',
    }, 502)
  }

  await service.from('share_access_codes').insert({
    identifier:   id.value,
    phone_digits: id.kind === 'phone' ? id.value : null,
    lead_id:      leadId,
    code_hash:    hashCode(code),
    // The channel that carries the code in practice. Email first: see above.
    channel:      sent[0].channel,
    destination:  sent.map(s => s.destination).join(', '),
    expires_at:   expires,
    ip,
  })

  return json({ ok: true, found: true, sent, expires_in: CODE_TTL_MINUTES * 60 })
}
