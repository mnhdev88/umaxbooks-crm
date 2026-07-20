#!/usr/bin/env node

/**
 * Point every Twilio voice number at the CRM's inbound-call webhook.
 *
 * Without this, a lead who calls one of our numbers back reaches nothing. Doing it
 * by hand in the console is six paste operations with a secret in each URL — one
 * typo and that number silently 401s, which you'd only notice as missed callbacks.
 *
 * Requires migration 092_inbound_calls.sql and a deploy of the /incoming route.
 *
 * Usage:
 *   node scripts/set-twilio-voice-webhooks.mjs              # DRY RUN — shows what would change
 *   node scripts/set-twilio-voice-webhooks.mjs --run        # apply
 *   node scripts/set-twilio-voice-webhooks.mjs --run --pool # only numbers in caller_numbers
 *
 * Env (read from .env.local automatically):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, NEXT_PUBLIC_APP_URL, TWILIO_WEBHOOK_SECRET
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (only for --pool)
 */

import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'
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
const POOL_ONLY = process.argv.includes('--pool')

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  NEXT_PUBLIC_APP_URL,
  TWILIO_WEBHOOK_SECRET,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env

for (const [k, v] of Object.entries({ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, NEXT_PUBLIC_APP_URL })) {
  if (!v) {
    console.error(`Missing required env ${k}.`)
    process.exit(1)
  }
}

// The /incoming route rejects any request without this, mirroring /status.
if (!TWILIO_WEBHOOK_SECRET) {
  console.error('Missing TWILIO_WEBHOOK_SECRET — the inbound route would 401 every call.')
  process.exit(1)
}

const voiceUrl =
  `${NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/voice/twilio/incoming` +
  `?secret=${encodeURIComponent(TWILIO_WEBHOOK_SECRET)}`

/** Hide the secret in anything we print — this output tends to end up in tickets. */
const redact = (s) => (s || '').replace(encodeURIComponent(TWILIO_WEBHOOK_SECRET), '<secret>')

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

// ── Optionally narrow to the numbers actually in the dialer pool ───────────
let poolNumbers = null
if (POOL_ONLY) {
  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('--pool needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }
  const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data, error } = await supabase.from('caller_numbers').select('phone_number')
  if (error) {
    console.error('Could not read caller_numbers:', error.message)
    process.exit(1)
  }
  poolNumbers = new Set((data || []).map((r) => r.phone_number))
  if (poolNumbers.size === 0) {
    console.error('caller_numbers is empty — nothing to do. Add numbers in Settings first.')
    process.exit(1)
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────
const numbers = await client.incomingPhoneNumbers.list({ limit: 200 })

if (numbers.length === 0) {
  console.error('No phone numbers on this Twilio account.')
  process.exit(1)
}

console.log(`${RUN ? 'APPLYING' : 'DRY RUN'} — target voice URL:\n  ${redact(voiceUrl)}\n`)

let changed = 0
let skipped = 0
let failed = 0

for (const n of numbers) {
  const label = `${n.phoneNumber}${n.friendlyName && n.friendlyName !== n.phoneNumber ? ` (${n.friendlyName})` : ''}`

  if (poolNumbers && !poolNumbers.has(n.phoneNumber)) {
    console.log(`  skip   ${label} — not in caller_numbers`)
    skipped++
    continue
  }
  // A number wired to a TwiML App for voice is our OUTBOUND softphone app; setting a
  // voiceUrl on it would not take effect while voiceApplicationSid is set, so flag it
  // rather than silently doing nothing.
  if (n.voiceApplicationSid) {
    console.log(`  WARN   ${label} — bound to TwiML App ${n.voiceApplicationSid}; clear that in the console for inbound to work`)
    skipped++
    continue
  }
  if (n.voiceUrl === voiceUrl && (n.voiceMethod || '').toUpperCase() === 'POST') {
    console.log(`  ok     ${label} — already correct`)
    skipped++
    continue
  }

  console.log(`  set    ${label}`)
  if (n.voiceUrl) console.log(`         was: ${redact(n.voiceUrl)} [${n.voiceMethod}]`)

  if (!RUN) {
    changed++
    continue
  }

  try {
    await client.incomingPhoneNumbers(n.sid).update({ voiceUrl, voiceMethod: 'POST' })
    changed++
  } catch (e) {
    console.error(`         FAILED: ${e.message}`)
    failed++
  }
}

console.log(
  `\n${RUN ? 'Updated' : 'Would update'} ${changed} number(s); ${skipped} skipped; ${failed} failed.`
)
if (!RUN && changed > 0) console.log('Re-run with --run to apply.')
process.exit(failed > 0 ? 1 : 0)
