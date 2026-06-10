import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { toE164US, verifyTwilioRequest } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/voice — TwiML webhook for the browser softphone.
 *
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts. Twilio fetches
 * this when the browser's Device places an outbound call. The browser passes the target
 * number and CRM leadId as connect() params, which arrive here as POST form fields. We
 * return TwiML telling Twilio to <Dial> the lead from our caller ID, record the call,
 * and post lifecycle + recording events to /status.
 *
 * Signed by Twilio (X-Twilio-Signature); verified against TWILIO_AUTH_TOKEN.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const signature = req.headers.get('x-twilio-signature')
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twilio/voice`
  if (!verifyTwilioRequest(signature, url, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const VoiceResponse = twilio.twiml.VoiceResponse
  const twiml = new VoiceResponse()

  // The browser sends these via device.connect({ params: { To, leadId } }).
  const to = (params.To || params.to || '').trim()
  const leadId = (params.leadId || '').trim()
  // From a client call this looks like "client:agent_<userId>".
  const agent = (params.From || '').replace(/^client:/, '')

  if (!to) {
    twiml.say('No destination number was provided. Goodbye.')
    return xml(twiml)
  }

  const callerId = process.env.TWILIO_CALLER_ID
  if (!callerId) {
    twiml.say('The dialer is not configured. Please contact an administrator.')
    return xml(twiml)
  }

  const secret = process.env.TWILIO_WEBHOOK_SECRET || ''
  const cb = (kind: string) => {
    const u = new URL(`${process.env.NEXT_PUBLIC_APP_URL}/api/voice/twilio/status`)
    if (secret) u.searchParams.set('secret', secret)
    if (leadId) u.searchParams.set('leadId', leadId)
    if (agent) u.searchParams.set('agent', agent)
    u.searchParams.set('kind', kind)
    return u.toString()
  }

  // answerOnBridge: caller hears ringback (not dead air) until the lead picks up.
  // record dual channel so we capture both sides; recording URL arrives on /status.
  const dial = twiml.dial({
    callerId,
    answerOnBridge: true,
    record: 'record-from-answer-dual',
    recordingStatusCallback: cb('recording'),
    recordingStatusCallbackEvent: ['completed'],
    action: cb('dial'),
    method: 'POST',
  })
  dial.number(toE164US(to))

  return xml(twiml)
}

function xml(twiml: { toString(): string }): NextResponse {
  return new NextResponse(twiml.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  })
}
