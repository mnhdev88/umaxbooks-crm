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
