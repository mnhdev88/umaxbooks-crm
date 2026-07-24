#!/usr/bin/env node

/**
 * Point the SMS number's Messaging webhook at the CRM so inbound replies reach us.
 *
 * When a lead texts back, Twilio POSTs the message to whatever "A MESSAGE COMES IN" URL
 * is set on that number. Out of the box that's unset (replies vanish) or the stock demo.
 * This sets it to /api/voice/twilio/sms/incoming with the shared secret, matching how
 * set-twilio-voice-webhooks.mjs wires the voice side.
 *
 * Only the number in TWILIO_SMS_FROM is touched — that's the one we send from and the one
 * leads reply to. (Outbound delivery-status callbacks are set per-message by the send
 * route, so no number-level config is needed for those.)
 *
 * Usage:
 *   node scripts/set-twilio-sms-webhooks.mjs           # DRY RUN — shows what would change
 *   node scripts/set-twilio-sms-webhooks.mjs --run     # apply
 *
 * Env (read from .env.local automatically):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, NEXT_PUBLIC_APP_URL, TWILIO_WEBHOOK_SECRET, TWILIO_SMS_FROM
 */

import twilio from 'twilio'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local (node does not do this automatically) ──────────────────
try {
  const envFile = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {
  console.error('Could not read .env.local — relying on the ambient environment.')
}

const RUN = process.argv.includes('--run')

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  NEXT_PUBLIC_APP_URL,
  TWILIO_WEBHOOK_SECRET,
  TWILIO_SMS_FROM,
} = process.env

for (const [k, v] of Object.entries({
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  NEXT_PUBLIC_APP_URL,
  TWILIO_SMS_FROM,
})) {
  if (!v) {
    console.error(`Missing required env ${k}.`)
    process.exit(1)
  }
}

// The /incoming route rejects any request without this, mirroring the voice /status route.
if (!TWILIO_WEBHOOK_SECRET) {
  console.error('Missing TWILIO_WEBHOOK_SECRET — the inbound SMS route would 401 every reply.')
  process.exit(1)
}

const BASE = NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
const SMS_URL = `${BASE}/api/voice/twilio/sms/incoming?secret=${encodeURIComponent(TWILIO_WEBHOOK_SECRET)}`
const redact = (s) => (s || '').replace(encodeURIComponent(TWILIO_WEBHOOK_SECRET), '<secret>')

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

// Match the configured from-number to an owned Twilio number (compare last 10 digits so
// formatting differences don't matter).
const last10 = (s) => (s || '').replace(/\D/g, '').slice(-10)
const want = last10(TWILIO_SMS_FROM)

const numbers = await client.incomingPhoneNumbers.list({ limit: 200 })
const match = numbers.find((n) => last10(n.phoneNumber) === want)

if (!match) {
  console.error(
    `TWILIO_SMS_FROM (${TWILIO_SMS_FROM}) is not a number on this Twilio account. ` +
      `Buy/port it or enable SMS on it in the Twilio Console first.`
  )
  process.exit(1)
}

console.log(`${RUN ? 'APPLYING' : 'DRY RUN'} — SMS number ${match.phoneNumber}`)
console.log(`  target Messaging webhook: ${redact(SMS_URL)} [POST]`)
if (match.smsUrl) console.log(`  current: ${redact(match.smsUrl)} [${match.smsMethod}]`)

const alreadyCorrect = match.smsUrl === SMS_URL && (match.smsMethod || '').toUpperCase() === 'POST'
if (alreadyCorrect) {
  console.log('\nAlready correct — nothing to do.')
  process.exit(0)
}

// A number wired to a Messaging Service takes its inbound webhook from the service, not
// the number, so setting smsUrl here would not take effect — flag it instead.
if (match.smsApplicationSid) {
  console.log(
    `\nWARN: ${match.phoneNumber} is bound to Messaging Service / App ${match.smsApplicationSid}. ` +
      `Set the inbound webhook on that service in the Console, or detach it, then re-run.`
  )
  process.exit(1)
}

if (!RUN) {
  console.log('\nWould update 1 number. Re-run with --run to apply.')
  process.exit(0)
}

try {
  await client.incomingPhoneNumbers(match.sid).update({ smsUrl: SMS_URL, smsMethod: 'POST' })
  console.log('\nUpdated. Inbound replies will now reach the CRM.')
} catch (e) {
  console.error(`\nFAILED: ${e.message}`)
  process.exit(1)
}
