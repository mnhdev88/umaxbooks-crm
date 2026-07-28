import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { managersForAgent } from '@/lib/notify/managers'

// How long a demo may sit before it's considered stalled. Long enough that a
// demo booked in the afternoon doesn't alert overnight, short enough to rescue
// the build before the client call.
const STALL_HOURS = 24

/**
 * Flags demos that have gone quiet, in the two ways they can:
 *
 *   1. Never started — the lead reached "Demo Scheduled" over STALL_HOURS ago
 *      and no developer has claimed it. Nothing else in the app fires here,
 *      because nobody acting IS the event.
 *   2. Started but never finished — a developer claimed it over STALL_HOURS ago
 *      and still hasn't submitted. A start notification alone would mask this.
 *
 * Recipients are the sales manager(s) over the lead's assigned agent, plus all
 * admins. stall_alerted_at (and, for case 1, a synthetic marker row) keeps each
 * stalled demo to a single alert rather than one per tick.
 *
 * Bearer CRON_SECRET, like every other cron here. Note that vercel.json crons
 * do NOT fire under PM2 — this needs an entry in the server crontab.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const cutoff = new Date(Date.now() - STALL_HOURS * 60 * 60 * 1000).toISOString()

  const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
  const adminIds: string[] = (admins || []).map((a: any) => a.id)

  const rows: any[] = []
  const alertedBuildIds: string[] = []

  // Collect recipients for a lead: its manager(s) + every admin.
  async function recipientsFor(assignedAgentId: string | null) {
    const ids = new Set<string>(await managersForAgent(supabase, assignedAgentId))
    adminIds.forEach((id) => ids.add(id))
    return [...ids]
  }

  // ── Case 2: claimed but never submitted ───────────────────────────────────
  const { data: stuck, error: stuckErr } = await supabase
    .from('demo_builds')
    .select('id, lead_id, started_at, developer:profiles(full_name), lead:leads(company_name, assigned_agent_id)')
    .eq('status', 'building')
    .is('stall_alerted_at', null)
    .lt('started_at', cutoff)
    .limit(100)

  if (stuckErr) {
    console.error('[demo-build-stalled] building query failed:', stuckErr)
    return NextResponse.json({ ok: false, error: stuckErr.message }, { status: 500 })
  }

  for (const b of (stuck || []) as any[]) {
    const days = Math.floor((Date.now() - new Date(b.started_at).getTime()) / 86400000)
    const who  = b.developer?.full_name || 'A developer'
    const co   = b.lead?.company_name || 'A client'
    const forHowLong = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${STALL_HOURS} hours`

    for (const user_id of await recipientsFor(b.lead?.assigned_agent_id ?? null)) {
      rows.push({
        user_id,
        lead_id: b.lead_id,
        title: 'Demo Build Stalled',
        message: `${co} — ${who} started this demo ${forHowLong} ago and hasn't submitted it yet.`,
        type: 'warning',
        link: `/leads/${b.lead_id}`,
      })
    }
    alertedBuildIds.push(b.id)
  }

  // ── Case 1: scheduled but nobody has claimed it ───────────────────────────
  // Only leads still sitting in "Demo Scheduled" — once it's Demo Done or
  // beyond, the build obviously happened.
  const { data: unclaimed, error: unclaimedErr } = await supabase
    .from('leads')
    .select('id, company_name, assigned_agent_id, updated_at, demo_builds(id)')
    .eq('status', 'Demo Scheduled')
    .lt('updated_at', cutoff)
    .limit(100)

  if (unclaimedErr) {
    console.error('[demo-build-stalled] unclaimed query failed:', unclaimedErr)
  }

  const neverStarted = ((unclaimed || []) as any[]).filter(
    (l) => !l.demo_builds || l.demo_builds.length === 0
  )

  for (const lead of neverStarted) {
    // No build row exists to hold stall_alerted_at, so dedupe against the alert
    // we already sent for this lead instead.
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', lead.id)
      .eq('title', 'Demo Not Started')

    if (count && count > 0) continue

    const co = lead.company_name || 'A client'
    for (const user_id of await recipientsFor(lead.assigned_agent_id ?? null)) {
      rows.push({
        user_id,
        lead_id: lead.id,
        title: 'Demo Not Started',
        message: `${co} — the demo was scheduled over ${STALL_HOURS} hours ago and no developer has started building it.`,
        type: 'warning',
        link: `/leads/${lead.id}`,
      })
    }
  }

  if (!rows.length) {
    return NextResponse.json({ ok: true, alerted: 0, message: 'No stalled demo builds' })
  }

  const { error: insErr } = await supabase.from('notifications').insert(rows)
  if (insErr) {
    // Don't stamp stall_alerted_at if the notify failed — retry next tick.
    console.error('[demo-build-stalled] notification insert failed:', insErr)
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })
  }

  if (alertedBuildIds.length) {
    await supabase
      .from('demo_builds')
      .update({ stall_alerted_at: new Date().toISOString() })
      .in('id', alertedBuildIds)
  }

  return NextResponse.json({
    ok: true,
    alerted: rows.length,
    stuckBuilds: alertedBuildIds.length,
    neverStarted: neverStarted.length,
  })
}
