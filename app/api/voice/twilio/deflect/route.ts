import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { verifyTwilioRequest } from '@/lib/voice/twilio'

/**
 * POST /api/voice/twilio/deflect — a lead called back an outbound-only pool number.
 *
 * Public (no session) — covered by the /api/voice whitelist in proxy.ts.
 *
 * The pool's outbound-only numbers (caller_numbers.inbound_mode = 'deflect', see 093)
 * point their Twilio Voice webhook here. Before this existed they were left on
 * Twilio's stock demo TwiML, so an interested lead who rang back heard a recording
 * thanking them for trying Twilio's documentation — an advert for someone else's
 * product, played at the exact moment the lead was most reachable.
 *
 * This deliberately does NOT ring anyone and does NOT record: the team wants live
 * callbacks on the two established lines only. All this owes the caller is ten
 * seconds telling them where to actually reach us.
 *
 * No DB write either. A deflected call has no agent, no recording and no outcome, so
 * a voice_calls row would only add noise to the dialer report — the console line is
 * enough to confirm the routing works. If callbacks here turn out to be frequent,
 * that's the signal to promote the number to inbound_mode='full' rather than to start
 * logging deflections.
 */

/** Where we send them. Falls back to the original main line. */
const MAIN_LINE = process.env.VOICE_MAIN_LINE || process.env.TWILIO_CALLER_ID || ''

/** "+19086395666" → "9 0 8, 6 3 9, 5 6 6 6" so Polly reads digits, not a number. */
function speakable(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim())
  if (!m) return e164.replace(/\D/g, '').split('').join(' ')
  return `${m[1].split('').join(' ')}, ${m[2].split('').join(' ')}, ${m[3].split('').join(' ')}`
}

export async function POST(req: NextRequest) {
  // Shared-secret backstop, mirroring /incoming and /status: verifyTwilioRequest
  // passes when TWILIO_AUTH_TOKEN is unset (a dev convenience), so the webhook URL
  // configured on each number must carry ?secret=…
  const expected = process.env.TWILIO_WEBHOOK_SECRET
  const provided = req.nextUrl.searchParams.get('secret')
  if (expected && provided !== expected) {
    console.warn('[voice/twilio/deflect] rejected: missing or wrong ?secret= on the webhook URL')
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const signature = req.headers.get('x-twilio-signature')
  // Twilio signs the exact URL it called, query string included.
  const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}${req.nextUrl.pathname}${req.nextUrl.search}`
  if (!verifyTwilioRequest(signature, verifyUrl, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  console.log('[voice/twilio/deflect] callback deflected', {
    callSid: params.CallSid,
    from: params.From,
    to: params.To,
  })

  const VoiceResponse = twilio.twiml.VoiceResponse
  const twiml = new VoiceResponse()

  // Said twice: a caller who dialled back is reaching for a pen, and Twilio gives us
  // no way to know whether they caught it the first time.
  const line = MAIN_LINE
    ? `Thanks for calling Novelio Technologies. To reach our team, please call ${speakable(MAIN_LINE)}.`
    : 'Thanks for calling Novelio Technologies. Please visit novelio tech dot com to reach our team.'

  twiml.say({ voice: 'Polly.Joanna' }, line)
  twiml.pause({ length: 1 })
  twiml.say({ voice: 'Polly.Joanna' }, line)
  twiml.hangup()

  return xml(twiml)
}

function xml(twiml: { toString(): string }): NextResponse {
  return new NextResponse(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } })
}
