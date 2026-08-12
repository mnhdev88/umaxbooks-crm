#!/usr/bin/env node

/**
 * Re-credit inbound calls that the hunt group answered.
 *
 * Until the fix that ships alongside this script, stage=voicemail marked a hunt-answered
 * call with `markOutcome(..., 'answered-hunt', null)` — so `agent_user_id` kept the value
 * stamped when the call arrived: the lead's owner, i.e. the one agent we know did NOT
 * pick up. Every such call has been crediting the wrong person on the card and on the
 * lead's timeline.
 *
 * The answerer is still recoverable. `voice_calls.call_id` is the PARENT CallSid, and
 * Twilio can list a call's child legs by parent; the leg that connected is the one with
 * real duration, and its `to` is that agent's browser-client identity. Twilio keeps call
 * records ~13 months, which covers every inbound call this CRM has ever taken.
 *
 * Dry run by default — prints what it would change and touches nothing. `--apply` writes
 * and saves the previous values to a revert file so the change can be undone.
 *
 * Usage:
 *   node scripts/backfill-inbound-answerer.mjs            # dry run
 *   node scripts/backfill-inbound-answerer.mjs --apply    # write
 *   node scripts/backfill-inbound-answerer.mjs --revert <file.json>
 */

import twilio from 'twilio'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
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
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

/** The timeline line the old code wrote for a hunt-answered call. */
const TEAM_DETAILS = 'Lead called back. Answered by the team.'
/** How long after a call its timeline entry may land before we stop believing they pair. */
const PAIR_WINDOW_MS = 6 * 60 * 60 * 1000

// ── Revert mode ───────────────────────────────────────────────────────────────
const revertArg = process.argv.indexOf('--revert')
if (revertArg > -1) {
  const file = process.argv[revertArg + 1]
  if (!file) { console.error('Pass the revert file: --revert <file.json>'); process.exit(1) }
  const entries = JSON.parse(readFileSync(file, 'utf-8'))
  for (const e of entries) {
    await supabase.from('voice_calls').update({ agent_user_id: e.call.was }).eq('id', e.call.id)
    if (e.log) {
      await supabase
        .from('activity_logs')
        .update({ user_id: e.log.wasUser, details: e.log.wasDetails })
        .eq('id', e.log.id)
    }
  }
  console.log(`Reverted ${entries.length} call(s) from ${file}.`)
  process.exit(0)
}

// ── 1. The rows to fix ────────────────────────────────────────────────────────
const { data: calls, error } = await supabase
  .from('voice_calls')
  .select('id, call_id, lead_id, created_at, agent_user_id, leads(lead_number, name)')
  .eq('direction', 'inbound')
  .eq('inbound_outcome', 'answered-hunt')
  .order('created_at', { ascending: false })

if (error) { console.error('Could not read voice_calls:', error.message); process.exit(1) }
if (!calls.length) { console.log('No answered-hunt calls to check.'); process.exit(0) }

console.log(`${calls.length} hunt-answered call(s) to check.${APPLY ? '' : '  (dry run)'}\n`)

// ── 2. Ask Twilio who actually picked up ──────────────────────────────────────
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

/**
 * The child leg that connected. When one agent answers, Twilio cancels the rest, so the
 * answered leg is the one with real duration; longest wins if more than one qualifies.
 */
async function answererFor(parentCallSid) {
  const legs = await client.calls.list({ parentCallSid, limit: 30 })
  const answered = legs
    .filter(l => (l.to || '').startsWith('client:') && Number(l.duration || 0) > 0)
    .sort((a, b) => Number(b.duration || 0) - Number(a.duration || 0))[0]
  if (!answered) return null
  const m = /^client:agent_(.+)$/.exec(answered.to)
  return m ? m[1] : null
}

const resolved = []
const unresolved = []

for (const c of calls) {
  let userId = null
  try {
    userId = await answererFor(c.call_id)
  } catch (e) {
    unresolved.push({ call: c, why: `Twilio: ${e.message}` })
    continue
  }
  if (!userId) { unresolved.push({ call: c, why: 'no answered client leg in Twilio' }); continue }
  resolved.push({ call: c, userId })
}

// ── 3. Names, and a sanity check that the answerer is a real profile ──────────
const ids = [...new Set(resolved.flatMap(r => [r.userId, r.call.agent_user_id]).filter(Boolean))]
const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids)
const nameOf = new Map((profiles || []).map(p => [p.id, p.full_name]))

const changes = []
const alreadyRight = []
for (const r of resolved) {
  if (!nameOf.has(r.userId)) {
    unresolved.push({ call: r.call, why: `answered by ${r.userId}, which has no profile` })
    continue
  }
  if (r.userId === r.call.agent_user_id) { alreadyRight.push(r); continue }
  changes.push(r)
}

// ── 4. Pair each corrected call with its timeline entry ───────────────────────
// activity_logs doesn't reference a call, so pair by lead and time: the "Answered by the
// team." entry is written when the call ends, minutes after the row we hold. Each entry
// is claimed once, and anything ambiguous is reported rather than guessed at.
const leadIds = [...new Set(changes.map(c => c.call.lead_id).filter(Boolean))]
const { data: logs } = leadIds.length
  ? await supabase
      .from('activity_logs')
      .select('id, lead_id, user_id, details, created_at')
      .eq('action', 'Inbound Call')
      .eq('details', TEAM_DETAILS)
      .in('lead_id', leadIds)
  : { data: [] }

const claimed = new Set()
for (const ch of changes) {
  const callAt = new Date(ch.call.created_at).getTime()
  const candidates = (logs || [])
    .filter(l => l.lead_id === ch.call.lead_id && !claimed.has(l.id))
    .map(l => ({ l, gap: new Date(l.created_at).getTime() - callAt }))
    .filter(x => x.gap >= 0 && x.gap <= PAIR_WINDOW_MS)
    .sort((a, b) => a.gap - b.gap)
  if (candidates.length) {
    ch.log = candidates[0].l
    claimed.add(ch.log.id)
  }
}

// ── 5. Report ─────────────────────────────────────────────────────────────────
const label = c => `NVL-${String(c.leads?.lead_number ?? '????').padStart(4, '0')} ${c.leads?.name ?? ''}`.trim()

for (const ch of changes) {
  const was = nameOf.get(ch.call.agent_user_id) || ch.call.agent_user_id || '(nobody)'
  console.log(
    `  ${ch.call.created_at.slice(0, 16)}  ${label(ch.call)}\n` +
    `      credited ${was}  →  ${nameOf.get(ch.userId)}${ch.log ? '   (+ timeline entry)' : '   (no timeline entry found)'}`
  )
}
console.log(
  `\n${changes.length} to re-credit, ${alreadyRight.length} already correct, ${unresolved.length} unresolved.`
)
for (const u of unresolved) console.log(`  skipped ${label(u.call)} — ${u.why}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write these changes.')
  process.exit(0)
}

// ── 6. Write, keeping enough to undo it ───────────────────────────────────────
const revert = []
for (const ch of changes) {
  const { error: callErr } = await supabase
    .from('voice_calls')
    .update({ agent_user_id: ch.userId })
    .eq('id', ch.call.id)
  if (callErr) { console.error(`  failed ${label(ch.call)}: ${callErr.message}`); continue }

  const entry = { call: { id: ch.call.id, was: ch.call.agent_user_id, now: ch.userId } }

  if (ch.log) {
    const { error: logErr } = await supabase
      .from('activity_logs')
      .update({
        user_id: ch.userId,
        details: `Lead called back. Answered by ${nameOf.get(ch.userId)}.`,
      })
      .eq('id', ch.log.id)
    if (logErr) console.error(`  timeline entry for ${label(ch.call)} failed: ${logErr.message}`)
    else entry.log = { id: ch.log.id, wasUser: ch.log.user_id, wasDetails: ch.log.details }
  }

  revert.push(entry)
}

const stamp = calls[0].created_at.slice(0, 10)
const file = join(__dirname, `backfill-inbound-answerer.revert.${stamp}.json`)
writeFileSync(file, JSON.stringify(revert, null, 2))
console.log(`\nUpdated ${revert.length} call(s). To undo:\n  node scripts/backfill-inbound-answerer.mjs --revert ${file}`)
