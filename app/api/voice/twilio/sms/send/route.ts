import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSms, smsFromNumber, toE164US } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/sms/send — an agent sends a text to a lead.
 *
 * The SMS analog of the dialer: called from the lead page's SMS thread. Sends via the
 * Twilio REST API from our dedicated SMS number (TWILIO_SMS_FROM), records the outbound
 * row on sms_messages, and drops a timeline entry. Twilio then posts delivery updates to
 * /api/voice/twilio/sms/status, matched back by message_sid.
 *
 * Auth: requires a logged-in staff session; the DB write uses the service client because
 * sms_messages is service-role-write (RLS allows staff SELECT only), mirroring the
 * disposition route.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { leadId?: string; to?: string; body?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const to = (body.to || '').trim()
  const text = (body.body || '').trim()
  const leadId = body.leadId || null

  if (!to) return NextResponse.json({ error: 'Recipient number required' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Message body required' }, { status: 400 })
  // Twilio's hard ceiling for a single API call is 1600 chars (it segments internally).
  if (text.length > 1600) {
    return NextResponse.json({ error: 'Message too long (max 1600 characters)' }, { status: 400 })
  }

  const toE164 = toE164US(to)
  const from = smsFromNumber()
  if (!from) {
    console.error('[voice/twilio/sms/send] no SMS from-number configured (TWILIO_SMS_FROM)')
    return NextResponse.json({ error: 'SMS is not configured on the server' }, { status: 500 })
  }

  // Twilio POSTs delivery lifecycle here; the secret gates it (mirrors the voice /status route).
  const secret = process.env.TWILIO_WEBHOOK_SECRET
  const statusCallback = secret
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twilio/sms/status?secret=${encodeURIComponent(secret)}`
    : undefined

  let result: { sid: string; status: string }
  try {
    result = await sendSms({ to: toE164, from, body: text, statusCallback })
  } catch (e) {
    // Surface the Twilio error to the agent — a failed send is immediately actionable
    // (unregistered A2P, invalid number, SMS not enabled on the from-number, etc.).
    const msg = e instanceof Error ? e.message : 'Failed to send'
    console.error('[voice/twilio/sms/send] Twilio send failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  try {
    const svc = createServiceClient()

    const { data: inserted, error } = await svc
      .from('sms_messages')
      .insert({
        provider: 'twilio',
        direction: 'outbound',
        lead_id: leadId,
        from_number: from,
        to_number: toE164,
        body: text,
        status: result.status,
        message_sid: result.sid,
        agent_user_id: user.id,
      })
      .select()
      .single()

    if (error) throw error

    if (leadId) {
      const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text
      await svc.from('activity_logs').insert({
        lead_id: leadId,
        user_id: user.id,
        action: 'SMS Sent',
        details: `Text sent to ${toE164}: "${preview}"`,
      })
    }

    return NextResponse.json({ ok: true, message: inserted })
  } catch (e) {
    // The text WAS sent — only our logging failed. Report success so the UI reflects the
    // real-world outcome; the status webhook will still upsert the row by message_sid.
    console.error('[voice/twilio/sms/send] sent but failed to persist', result.sid, e)
    return NextResponse.json({
      ok: true,
      message: {
        direction: 'outbound',
        from_number: from,
        to_number: toE164,
        body: text,
        status: result.status,
        message_sid: result.sid,
        created_at: new Date().toISOString(),
      },
    })
  }
}
