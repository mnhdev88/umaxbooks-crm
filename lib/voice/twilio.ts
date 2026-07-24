/**
 * Twilio browser-softphone helpers (human click-to-call dialer).
 *
 * Unlike lib/voice/bland.ts (an autonomous AI agent that calls leads), this powers a
 * live dialer: a staff member clicks a lead and talks through their browser via the
 * Twilio Voice JS SDK. The browser registers a Device with a short-lived Access Token
 * minted here, places a call to the TwiML App, and Twilio fetches our /voice TwiML to
 * <Dial> the lead. Twilio then posts call lifecycle to /status.
 *
 * Required env:
 *   TWILIO_ACCOUNT_SID      – account SID (dashboard home)
 *   TWILIO_API_KEY_SID      – Standard API key SID (Account → API keys)
 *   TWILIO_API_KEY_SECRET   – the key's secret (shown once at creation)
 *   TWILIO_TWIML_APP_SID    – TwiML App SID; its Voice URL → /api/voice/twilio/voice
 *   TWILIO_CALLER_ID        – voice-enabled number you own (E.164), the outbound caller ID
 * Optional env:
 *   TWILIO_AUTH_TOKEN       – used to verify X-Twilio-Signature on webhooks
 *   TWILIO_WEBHOOK_SECRET   – shared secret on the status-callback URL
 *   TWILIO_SMS_FROM         – dedicated SMS-enabled number (E.164) for outbound texts
 *
 * Docs: https://www.twilio.com/docs/voice/sdks/javascript
 */

import twilio from 'twilio'

const { AccessToken } = twilio.jwt
const { VoiceGrant } = AccessToken

/** Identity string embedded in the access token. We key it to the CRM user id. */
export function clientIdentityForUser(userId: string): string {
  // Twilio client identities allow alphanumerics plus '-' and '_'. We keep dashes so
  // the UUID survives round-trip (userIdFromIdentity reverses this).
  return `agent_${userId}`.replace(/[^a-zA-Z0-9_-]/g, '')
}

/** Reverse clientIdentityForUser: pull the CRM user id back out of a client identity. */
export function userIdFromIdentity(identity: string): string | null {
  const m = /^agent_(.+)$/.exec(identity || '')
  return m ? m[1] : null
}

/**
 * Mint a short-lived Voice access token for the browser SDK. The token grants the
 * holder the right to place calls through our TwiML App and to receive incoming
 * calls addressed to its identity.
 */
export function mintVoiceToken(userId: string, ttlSeconds = 3600): string {
  const accountSid = required('TWILIO_ACCOUNT_SID')
  const apiKeySid = required('TWILIO_API_KEY_SID')
  const apiKeySecret = required('TWILIO_API_KEY_SECRET')
  const appSid = required('TWILIO_TWIML_APP_SID')

  const identity = clientIdentityForUser(userId)

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: ttlSeconds,
  })

  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: appSid,
      // Allow the browser to also receive calls routed to this identity (future inbound).
      incomingAllow: true,
    })
  )

  return token.toJwt()
}

/** Normalise a US phone number to E.164 (+1XXXXXXXXXX). Mirrors bland.ts. */
export function toE164US(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}

/**
 * Verify a Twilio webhook request. Twilio signs each request with your auth token over
 * the full URL + sorted POST params (X-Twilio-Signature). We additionally honour a
 * shared ?secret= on the URL the same way the Bland webhook does. Returns true if the
 * request is trustworthy (or if verification is intentionally unconfigured in dev).
 */
export function verifyTwilioRequest(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.warn('[twilio] TWILIO_AUTH_TOKEN not set — skipping signature verification (dev only)')
    return true
  }
  if (!signature) return false
  try {
    return twilio.validateRequest(authToken, signature, url, params)
  } catch (e) {
    console.error('[twilio] validateRequest threw', e)
    return false
  }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`[twilio] Missing required env ${name}`)
  return v
}

// ── Conversational Intelligence (transcription of human dialer calls) ─────────

/** REST client authenticated with the account auth token (server-side only). */
function restClient() {
  return twilio(required('TWILIO_ACCOUNT_SID'), required('TWILIO_AUTH_TOKEN'))
}

// ── SMS (two-way texting with leads) ──────────────────────────────────────────

export interface SendSmsResult {
  /** Twilio Message SID (SMxx…) — the key delivery-status callbacks arrive keyed to. */
  sid: string
  /** Twilio's initial status: usually 'queued' or 'accepted'. */
  status: string
}

/**
 * The number outbound texts are sent from (E.164). A dedicated SMS line kept separate
 * from the voice caller-ID rotation, falling back to TWILIO_CALLER_ID only if unset so a
 * misconfigured deploy still has *a* number rather than throwing deep in a request.
 */
export function smsFromNumber(): string {
  return process.env.TWILIO_SMS_FROM || process.env.TWILIO_CALLER_ID || ''
}

/**
 * Send an SMS via the Twilio REST API. `to` and `from` must be E.164 (use toE164US on
 * the destination first). When `statusCallback` is supplied Twilio POSTs delivery
 * lifecycle (sent → delivered | undelivered | failed) there. Throws on API error — unlike
 * the fire-and-forget voice webhooks, a failed send is worth surfacing to the agent
 * immediately (and, on US long codes, a 30007 here is the tell that A2P 10DLC isn't
 * registered).
 */
export async function sendSms(opts: {
  to: string
  body: string
  from?: string
  statusCallback?: string
}): Promise<SendSmsResult> {
  const from = opts.from || smsFromNumber()
  if (!from) throw new Error('[twilio] No SMS from-number configured (set TWILIO_SMS_FROM)')
  const msg = await restClient().messages.create({
    to: opts.to,
    from,
    body: opts.body,
    ...(opts.statusCallback ? { statusCallback: opts.statusCallback } : {}),
  })
  return { sid: msg.sid, status: msg.status }
}

/**
 * Kick off transcription of a dialer recording via Conversational Intelligence. The
 * recording's CallSid is stored as the transcript's customerKey so the completion
 * webhook can map the result back to our voice_calls row. No-op (returns null) when no
 * Intelligence service is configured. Best-effort — callers swallow errors.
 */
export async function createDialerTranscript(
  recordingSid: string,
  callSid: string
): Promise<string | null> {
  const serviceSid = process.env.TWILIO_INTELLIGENCE_SERVICE_SID
  if (!serviceSid || !recordingSid) return null
  const t = await restClient().intelligence.v2.transcripts.create({
    serviceSid,
    channel: { media_properties: { source_sid: recordingSid } },
    customerKey: callSid || undefined,
  })
  return t.sid
}

/**
 * Fetch a finished transcript and flatten its sentences into readable text. Returns the
 * customerKey (our CallSid) so the webhook knows which call to attach it to.
 */
export async function fetchTranscript(
  transcriptSid: string
): Promise<{ text: string; customerKey: string | null }> {
  const client = restClient()
  const meta = await client.intelligence.v2.transcripts(transcriptSid).fetch()
  const sentences = await client.intelligence.v2
    .transcripts(transcriptSid)
    .sentences.list({ limit: 1000 })

  const text = sentences
    .slice()
    .sort((a, b) => (a.sentenceIndex ?? 0) - (b.sentenceIndex ?? 0))
    .map((s) => {
      const speaker = s.mediaChannel != null ? `Speaker ${s.mediaChannel}` : 'Speaker'
      return `${speaker}: ${s.transcript ?? ''}`.trim()
    })
    .filter(Boolean)
    .join('\n')

  return { text, customerKey: meta.customerKey ?? null }
}
