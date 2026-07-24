import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTwilioRequest } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/sms/incoming — a lead texts us back.
 *
 * Twilio's Messaging webhook for our SMS number posts here on every inbound message.
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts, gated by the
 * shared ?secret= then X-Twilio-Signature, exactly like the voice /status route.
 *
 * We resolve the sender to a lead via lead_id_for_phone() (092 — matches the last 10
 * digits against leads.phone and every alt_phone), record the inbound row, drop a
 * timeline entry, and notify the assigned agent. We reply with empty TwiML so Twilio
 * sends no auto-response — the agent replies from the CRM thread.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.TWILIO_WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const signature = req.headers.get('x-twilio-signature')
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`
  if (!verifyTwilioRequest(signature, verifyUrl, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const from = params.From || ''       // the lead's number
  const to = params.To || ''           // our SMS number
  const messageBody = params.Body || ''
  const messageSid = params.MessageSid || params.SmsSid || ''
  const numMedia = Number(params.NumMedia || '0') || 0

  console.log('[voice/twilio/sms/incoming]', { from, to, messageSid, numMedia })

  if (!messageSid || !from) return twiml()

  try {
    const svc = createServiceClient()

    // Resolve the sender to a lead (SECURITY DEFINER RPC, service_role only).
    const { data: leadId } = await svc.rpc('lead_id_for_phone', { p_phone: from })

    // Upsert on message_sid so a Twilio retry can't double-insert the same reply.
    await svc.from('sms_messages').upsert(
      {
        provider: 'twilio',
        direction: 'inbound',
        lead_id: leadId ?? null,
        from_number: from,
        to_number: to,
        body: messageBody,
        num_media: numMedia,
        status: 'received',
        message_sid: messageSid,
      },
      { onConflict: 'message_sid', ignoreDuplicates: false }
    )

    if (leadId) {
      const preview =
        (messageBody || (numMedia > 0 ? `[${numMedia} attachment(s)]` : '')).slice(0, 120)

      await svc.from('activity_logs').insert({
        lead_id: leadId,
        user_id: null,
        action: 'SMS Received',
        details: `Text reply from ${from}: "${preview}"`,
      })

      // Notify the agent who owns the lead so replies don't sit unseen.
      const { data: lead } = await svc
        .from('leads')
        .select('assigned_agent_id, company_name, name')
        .eq('id', leadId)
        .single()

      if (lead?.assigned_agent_id) {
        const who = lead.company_name || lead.name || 'A lead'
        await svc.from('notifications').insert({
          user_id: lead.assigned_agent_id,
          lead_id: leadId,
          title: 'New SMS Reply',
          message: `${who} replied: "${preview}"`,
          type: 'info',
        })
      }
    }
  } catch (e) {
    console.error('[voice/twilio/sms/incoming] failed to persist', messageSid, e)
  }

  return twiml()
}

/**
 * Empty TwiML. Twilio's Messaging webhook expects TwiML (or an empty 200) back; an empty
 * <Response/> means "no auto-reply" — the agent answers from the CRM thread. Returning
 * JSON here makes Twilio log a 12300 and can trip an error auto-reply.
 */
function twiml(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
