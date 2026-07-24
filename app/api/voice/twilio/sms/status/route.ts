import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyTwilioRequest } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/sms/status — Twilio delivery-status callbacks for outbound texts.
 *
 * Set as the statusCallback when we send (see the send route). Twilio fires it as the
 * message advances: sent → delivered, or undelivered/failed with an ErrorCode. We update
 * the sms_messages row keyed by message_sid so the thread reflects real delivery state
 * (a carrier-filtered A2P message shows as 'undelivered' with code 30007, not a silent
 * "sent"). Public + secret + signature, same as the voice /status route.
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

  const messageSid = params.MessageSid || params.SmsSid || ''
  const status = params.MessageStatus || params.SmsStatus || ''
  const errorCode = params.ErrorCode || null

  console.log('[voice/twilio/sms/status]', { messageSid, status, errorCode })

  if (messageSid && status) {
    try {
      const svc = createServiceClient()
      const update: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      }
      if (errorCode) update.error_code = errorCode
      await svc.from('sms_messages').update(update).eq('message_sid', messageSid)
    } catch (e) {
      console.error('[voice/twilio/sms/status] failed to update', messageSid, e)
    }
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
