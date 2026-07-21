#!/usr/bin/env node

/**
 * Point each Twilio voice number at the right CRM webhook for its inbound_mode.
 *
 * Without this, a lead who calls one of our numbers back reaches whatever the Twilio
 * console last had on it — in practice the stock demo TwiML, which thanks them for
 * trying Twilio's documentation. Doing it by hand is one paste per number with a
 * secret in each URL; one typo and that number silently 401s, which you'd only
 * notice as missed callbacks.
 *
 * Each number's destination comes from caller_numbers.inbound_mode (migration 093):
 *   full    → /api/voice/twilio/incoming — ring the owning agent, then the hunt
 *             group, then voicemail (092). For the established lines.
 *   deflect → /api/voice/twilio/deflect  — speak a redirect to the main line and
 *             hang up. For outbound-only cold-call numbers, which shouldn't ring
 *             the whole team.
 * A number that isn't in caller_numbers at all is treated as 'full'.
 *
 * Requires migrations 092 + 093 and a deploy of both routes.
 *
 * Usage:
 *   node scripts/set-twilio-voice-webhooks.mjs              # DRY RUN — shows what would change
 *   node scripts/set-twilio-voice-webhooks.mjs --run        # apply
 *   node scripts/set-twilio-voice-webhooks.mjs --run --pool # only numbers in caller_numbers
 *
 * Env (read from .env.local automatically):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, NEXT_PUBLIC_APP_URL, TWILIO_WEBHOOK_SECRET
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

const BASE = NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
const SECRET_QS = `?secret=${encodeURIComponent(TWILIO_WEBHOOK_SECRET)}`

/**
 * Voice URL per inbound_mode (migration 093). A number is either a real inbound line
 * or an outbound-only number that deflects — pointing the whole pool at /incoming
 * would ring every agent seven different ways.
 */
const URL_FOR_MODE = {
  full: `${BASE}/api/voice/twilio/incoming${SECRET_QS}`,
  deflect: `${BASE}/api/voice/twilio/deflect${SECRET_QS}`,
}

/** Hide the secret in anything we print — this output tends to end up in tickets. */
const redact = (s) => (s || '').replace(encodeURIComponent(TWILIO_WEBHOOK_SECRET), '<secret>')

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

// ── Read the pool, which is what decides each number's inbound behaviour ───
// Always required now: the Voice URL depends on inbound_mode (093), so we can't
// choose one without reading the row.
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to read inbound_mode.')
  process.exit(1)
}
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const { data: poolRows, error: poolError } = await supabase
  .from('caller_numbers')
  .select('phone_number, inbound_mode')
if (poolError) {
  console.error('Could not read caller_numbers:', poolError.message)
  process.exit(1)
}
const modeByNumber = new Map((poolRows || []).map((r) => [r.phone_number, r.inbound_mode || 'deflect']))
if (POOL_ONLY && modeByNumber.size === 0) {
  console.error('caller_numbers is empty — nothing to do. Add numbers in Settings first.')
  process.exit(1)
}

// ── Apply ─────────────────────────────────────────────────────────────────
const numbers = await client.incomingPhoneNumbers.list({ limit: 200 })

if (numbers.length === 0) {
  console.error('No phone numbers on this Twilio account.')
  process.exit(1)
}

console.log(`${RUN ? 'APPLYING' : 'DRY RUN'} — target voice URLs:`)
for (const [mode, u] of Object.entries(URL_FOR_MODE)) console.log(`  ${mode.padEnd(8)} ${redact(u)}`)
console.log()

let changed = 0
let skipped = 0
let failed = 0

for (const n of numbers) {
  const label = `${n.phoneNumber}${n.friendlyName && n.friendlyName !== n.phoneNumber ? ` (${n.friendlyName})` : ''}`

  if (POOL_ONLY && !modeByNumber.has(n.phoneNumber)) {
    console.log(`  skip   ${label} — not in caller_numbers`)
    skipped++
    continue
  }

  // A number outside the pool is a line someone bought by hand, not a dialer number —
  // give it the full inbound treatment, which is what this script always did.
  const mode = modeByNumber.get(n.phoneNumber) || 'full'
  const voiceUrl = URL_FOR_MODE[mode]
  if (!voiceUrl) {
    console.log(`  WARN   ${label} — unknown inbound_mode '${mode}'; skipping`)
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
    console.log(`  ok     ${label} — already correct [${mode}]`)
    skipped++
    continue
  }

  console.log(`  set    ${label} → ${mode}`)
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
