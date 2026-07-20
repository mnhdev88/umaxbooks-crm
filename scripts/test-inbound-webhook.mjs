#!/usr/bin/env node

/**
 * Exercise the inbound-call webhook without a phone.
 *
 * Inbound routing can otherwise only be tested by actually calling the number, which
 * needs a deploy plus configured Twilio webhooks. This posts properly SIGNED requests
 * to a locally running dev server and prints the TwiML back, so the parts that are
 * easy to get wrong — lead resolution, stage chaining, <Client> targets, voicemail
 * fallback — can be checked in seconds.
 *
 * The route rebuilds its verification URL from NEXT_PUBLIC_APP_URL rather than the
 * request host, so a signature computed for the production URL validates fine against
 * localhost. That's what makes this possible.
 *
 * Usage:
 *   npm run dev                                     # in another terminal
 *   node scripts/test-inbound-webhook.mjs           # uses a real lead's phone
 *   node scripts/test-inbound-webhook.mjs --from +15550001111   # unknown caller
 *   node scripts/test-inbound-webhook.mjs --cleanup             # remove test rows
 *
 * Writes a voice_calls row with a TEST_INBOUND_ CallSid. Always finish with --cleanup.
 */

import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const envFile = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
  for (const line of envFile.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
} catch {
  console.error('Could not read .env.local')
  process.exit(1)
}

const {
  TWILIO_AUTH_TOKEN,
  TWILIO_WEBHOOK_SECRET,
  NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env

const LOCAL = process.env.TEST_BASE_URL || 'http://localhost:3000'
const CALL_SID = 'TEST_INBOUND_001'
const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Cleanup mode ──────────────────────────────────────────────────────────
if (process.argv.includes('--cleanup')) {
  const { error } = await supabase.from('voice_calls').delete().like('call_id', 'TEST_INBOUND_%')
  // The voicemail stage notifies the owning agent; drop those too.
  await supabase.from('notifications').delete().like('message', '%[test]%')
  console.log(error ? `Cleanup failed: ${error.message}` : 'Removed TEST_INBOUND_ rows.')
  process.exit(error ? 1 : 0)
}

const fromArg = process.argv.indexOf('--from')
let FROM = fromArg > -1 ? process.argv[fromArg + 1] : null
let expectedLead = null

if (!FROM) {
  // Use a lead we've actually dialed, so the "ring whoever last called them" path
  // has something to resolve rather than silently falling through to the hunt group.
  const { data } = await supabase
    .from('voice_calls')
    .select('lead_id, agent_user_id, leads(name, phone)')
    .eq('direction', 'outbound')
    .not('agent_user_id', 'is', null)
    .not('lead_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  FROM = data?.leads?.phone
  expectedLead = data?.leads?.name
  if (!FROM) {
    console.error('No previously-dialed lead found; pass --from +1XXXXXXXXXX')
    process.exit(1)
  }
}

const TO = '+19086395666'

/** POST a signed Twilio-style form request to one stage of the inbound route. */
async function hit(stage, extraParams = {}) {
  const qs = new URLSearchParams({ secret: TWILIO_WEBHOOK_SECRET, stage, ...extraParams.query })
  delete extraParams.query
  const path = `/api/voice/twilio/incoming?${qs}`

  // The route verifies against NEXT_PUBLIC_APP_URL + path, not the actual host.
  const signedUrl = `${NEXT_PUBLIC_APP_URL}${path}`
  const params = { From: FROM, To: TO, CallSid: CALL_SID, ...extraParams }
  const signature = twilio.getExpectedTwilioSignature(TWILIO_AUTH_TOKEN, signedUrl, params)

  const res = await fetch(`${LOCAL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params),
  })
  const body = await res.text()
  return { status: res.status, body }
}

function show(title, { status, body }) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
  console.log(`HTTP ${status}`)
  console.log(body.replace(/secret=[^&"]+/g, 'secret=<redacted>'))
}

console.log(`Caller:   ${FROM}${expectedLead ? `  (expect lead: ${expectedLead})` : ''}`)
console.log(`Called:   ${TO}`)
console.log(`Target:   ${LOCAL}`)

// Stage 1 — entry: should log the call and <Dial><Client> the owning agent.
show('stage=owner (call arrives)', await hit('owner'))

// Stage 2 — owner didn't pick up: should ring the rest of the team.
const { data: row } = await supabase
  .from('voice_calls')
  .select('lead_id, agent_user_id, inbound_outcome, from_number, to_number')
  .eq('call_id', CALL_SID)
  .maybeSingle()
console.log('\nRow written by stage 1:', row || '(none — stage 1 failed to log)')

show(
  'stage=hunt (owner did not answer)',
  await hit('hunt', {
    DialCallStatus: 'no-answer',
    query: { leadId: row?.lead_id || '', owner: row?.agent_user_id || '' },
  })
)

// Stage 3 — nobody picked up: should speak a prompt and <Record>.
show(
  'stage=voicemail (nobody answered)',
  await hit('voicemail', {
    DialCallStatus: 'no-answer',
    query: { leadId: row?.lead_id || '', owner: row?.agent_user_id || '' },
  })
)

// Also confirm the happy path short-circuits instead of escalating.
show(
  'stage=hunt (owner DID answer — should be an empty Response)',
  await hit('hunt', {
    DialCallStatus: 'completed',
    query: { leadId: row?.lead_id || '', owner: row?.agent_user_id || '' },
  })
)

const { data: final } = await supabase
  .from('voice_calls')
  .select('inbound_outcome, agent_user_id, from_number, to_number, direction')
  .eq('call_id', CALL_SID)
  .maybeSingle()
console.log('\nFinal row:', final)
console.log('\nRun with --cleanup to remove the test row.')
