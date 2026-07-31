#!/usr/bin/env node

/**
 * Backfill ZeroBounce email-validation verdicts for existing leads.
 *
 * Requires migration 047_lead_email_validation.sql to be applied first.
 *
 * Usage:
 *   node scripts/validate-all-lead-emails.mjs            # DRY RUN — counts + cost estimate, spends nothing
 *   node scripts/validate-all-lead-emails.mjs --run      # actually validate (only leads without a verdict yet)
 *   node scripts/validate-all-lead-emails.mjs --run --all # re-validate every lead with an email
 *   node scripts/validate-all-lead-emails.mjs --run --limit 25   # process at most 25 (good for a test pass)
 *   node scripts/validate-all-lead-emails.mjs --run --concurrency 4 --rate 0.0089
 *
 * Env (read from .env.local automatically):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ZEROBOUNCE_API_KEY
 */

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
    if (!m) continue
    const key = m[1]
    let val = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[key] === undefined) process.env[key] = val
  }
} catch { /* env may already be exported */ }

// ── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valOf = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const RUN          = has('--run')
const ALL          = has('--all')
const LIMIT        = parseInt(valOf('--limit', '0'), 10) || 0
const CONCURRENCY  = Math.max(1, parseInt(valOf('--concurrency', '5'), 10) || 5)
const RATE         = parseFloat(valOf('--rate', '0.007'))    // $ per validation — APPROX, check your ZeroBounce plan
const BATCH_DELAY  = 250 // ms between batches, to stay friendly with rate limits

const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
let   zbKey      = process.env.ZEROBOUNCE_API_KEY || ''

if (!url || !serviceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local)')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Fetch ALL leads with an email (paginate past the 1000-row PostgREST cap) ─
async function fetchAllLeadsWithEmail() {
  const PAGE = 1000
  let from = 0
  const rows = []
  for (;;) {
    const { data, error } = await supabase
      .from('leads')
      .select('id, email, email_verdict')
      .not('email', 'is', null)
      .neq('email', '')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      if (/email_verdict/.test(error.message)) {
        console.error('❌ Column email_verdict not found — apply migration 047_lead_email_validation.sql first.')
        process.exit(1)
      }
      console.error('❌ Fetch error:', error.message); process.exit(1)
    }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return rows
}

function verdictFromStatus(status) {
  if (status === 'valid') return 'Valid'
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) return 'Invalid'
  return 'Risky'
}

function scoreFromStatus(status) {
  if (status === 'valid') return 1
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) return 0
  return 0.5
}

async function validateOne(email) {
  // Local format gate — free, no API spend
  if (!EMAIL_RE.test(email)) {
    return { verdict: 'Invalid', score: 0, local: true }
  }
  const url = new URL('https://api.zerobounce.net/v2/validate')
  url.searchParams.set('api_key', zbKey)
  url.searchParams.set('email', email)
  url.searchParams.set('ip_address', '')

  const res = await fetch(url.toString())
  if (res.status === 429) return { rateLimited: true }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err?.error || `${res.status} ${res.statusText}` }
  }
  const data = await res.json()
  if (data?.error) return { error: data.error }
  return { verdict: verdictFromStatus(data?.status), score: scoreFromStatus(data?.status) }
}

;(async () => {
  console.log('📧 Lead email validation backfill\n')
  const all = await fetchAllLeadsWithEmail()
  const withEmail   = all.length
  const malformed   = all.filter((l) => !EMAIL_RE.test((l.email || '').trim()))
  const alreadyDone = all.filter((l) => l.email_verdict)
  let todo = ALL ? all : all.filter((l) => !l.email_verdict)
  // malformed are marked locally for free regardless; keep them in todo
  if (LIMIT > 0) todo = todo.slice(0, LIMIT)

  const billable = todo.filter((l) => EMAIL_RE.test((l.email || '').trim())).length
  const estCost  = (billable * RATE).toFixed(2)

  console.log(`  Leads with an email address : ${withEmail}`)
  console.log(`  Already have a verdict       : ${alreadyDone.length}`)
  console.log(`  Malformed (free, local only) : ${malformed.length}`)
  console.log(`  Will validate this run       : ${todo.length}  (${billable} billable ZeroBounce calls)`)
  console.log(`  Estimated cost               : ~$${estCost}  (@ $${RATE}/call — verify against your plan)\n`)

  if (!RUN) {
    console.log('🟡 DRY RUN. No emails were validated and nothing was written.')
    console.log('   Re-run with --run to execute. Tip: start with  --run --limit 20  to test.\n')
    if (todo.length) console.log('   Sample:', todo.slice(0, 5).map((l) => l.email).join(', '))
    process.exit(0)
  }

  if (!zbKey) { console.error('❌ No ZeroBounce API key (set ZEROBOUNCE_API_KEY in .env.local).'); process.exit(1) }

  const tally = { Valid: 0, Risky: 0, Invalid: 0, error: 0 }
  let done = 0

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (lead) => {
      const email = (lead.email || '').trim()
      let r = await validateOne(email)
      if (r.rateLimited) { await sleep(2000); r = await validateOne(email) } // one backoff retry
      if (r.error || !r.verdict) { tally.error++; console.warn(`  ⚠ ${email}: ${r.error || 'no verdict'}`); return }

      const { error } = await supabase.from('leads').update({
        email_verdict: r.verdict,
        email_score: r.score,
        email_validated_at: new Date().toISOString(),
      }).eq('id', lead.id)
      if (error) { tally.error++; console.warn(`  ⚠ update ${email}: ${error.message}`); return }
      tally[r.verdict] = (tally[r.verdict] || 0) + 1
    }))
    done += batch.length
    process.stdout.write(`\r  Progress: ${done}/${todo.length}`)
    await sleep(BATCH_DELAY)
  }

  console.log('\n\n✅ Done.')
  console.log(`   Valid: ${tally.Valid}   Risky: ${tally.Risky}   Invalid: ${tally.Invalid}   Errors: ${tally.error}\n`)
  process.exit(0)
})()
