import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { resolveIpBatch, formatGeoLabel, GEO_BATCH_SIZE } from '@/lib/geo-ip'

/**
 * Fills in the geo_* columns on email_engagement_events.
 *
 * The tracking routes record the IP but never geolocate it — the open pixel has to
 * return its GIF instantly, so a blocking lookup there would stall the recipient's
 * mail client. This cron drains that backlog instead.
 *
 * Only non-proxy rows are resolved (see the partial index from migration 099): a Gmail
 * or Apple-relay open carries a datacenter IP whose city says nothing about the lead,
 * so geolocating it would just manufacture a misleading location.
 *
 * geo_resolved_at is stamped on every row we get an answer about, INCLUDING rows the
 * service couldn't place. Otherwise an unresolvable IP would be re-queried on every
 * run forever. "Attempted" and "has a location" are therefore distinct states:
 * geo_resolved_at set + geo_city NULL means we asked and the service didn't know.
 *
 * Bearer CRON_SECRET, like every other cron here. Note that vercel.json crons do NOT
 * fire under PM2 — this needs an entry in the server crontab.
 */

// One batch per run. ip-api allows 15 batch requests/min; a single 100-IP call per
// invocation stays far clear of that even at a 5-minute schedule, and the backlog
// index makes the next run pick up wherever this one stopped.
const MAX_PER_RUN = GEO_BATCH_SIZE

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Matches email_engagement_events_geo_pending_idx exactly.
  const { data: pending, error: pendingErr } = await supabase
    .from('email_engagement_events')
    .select('id, ip, token')
    .is('geo_resolved_at', null)
    .not('ip', 'is', null)
    .eq('is_proxy', false)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (pendingErr) {
    console.error('[resolve-email-geo] backlog query failed:', pendingErr)
    return NextResponse.json({ error: 'Failed to read backlog' }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, resolved: 0, attempted: 0, message: 'Nothing to resolve' })
  }

  // Collapse duplicates: the same lead opening from one IP produces many rows, and
  // there's no reason to spend batch slots on repeats.
  const uniqueIps = [...new Set(pending.map(r => String(r.ip)))]

  let results
  try {
    results = await resolveIpBatch(uniqueIps.slice(0, GEO_BATCH_SIZE))
  } catch (err) {
    // Service down or rate-limited. Leave geo_resolved_at NULL so the next run retries.
    console.error('[resolve-email-geo] lookup failed:', err)
    return NextResponse.json({ error: 'Geo lookup failed', attempted: uniqueIps.length }, { status: 502 })
  }

  const byIp = new Map(results.map(r => [r.ip, r]))
  const now = new Date().toISOString()

  // Group row ids by the location they resolved to, so identical locations update in
  // one call rather than one call per row.
  const updates = new Map<string, { ids: string[]; geo: typeof results[number] | null }>()
  for (const row of pending) {
    const geo = byIp.get(String(row.ip)) || null
    // Key on the resolved values; 'unresolved' collects the rows we asked about but
    // couldn't place, which still get stamped so they leave the backlog.
    const key = geo ? `${geo.city}|${geo.region}|${geo.country}` : 'unresolved'
    const entry = updates.get(key)
    if (entry) entry.ids.push(row.id)
    else updates.set(key, { ids: [row.id], geo })
  }

  let resolved = 0
  for (const { ids, geo } of updates.values()) {
    const { error: updErr } = await supabase
      .from('email_engagement_events')
      .update({
        geo_city:        geo?.city    ?? null,
        geo_region:      geo?.region  ?? null,
        geo_country:     geo?.country ?? null,
        geo_resolved_at: now,
      })
      .in('id', ids)

    if (updErr) {
      console.error('[resolve-email-geo] event update failed:', updErr)
      continue
    }
    if (geo) resolved += ids.length
  }

  // Refresh the denormalised label the Email Status list reads, so the Location column
  // shows a city instead of a bare IP. Only the most recent open per email matters, and
  // only for non-proxy opens — a proxied open renders as "Hidden" regardless.
  const tokens = [...new Set(pending.map(r => String(r.token)))]
  let labelled = 0
  for (const token of tokens) {
    const { data: latest } = await supabase
      .from('email_engagement_events')
      .select('ip, geo_city, geo_region, geo_country')
      .eq('token', token)
      .eq('event_type', 'open')
      .eq('is_proxy', false)
      .not('geo_resolved_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest) continue
    const label = formatGeoLabel({
      city: latest.geo_city, region: latest.geo_region, country: latest.geo_country,
    })
    if (!label) continue

    const { error: trackErr } = await supabase
      .from('email_tracking')
      .update({ last_open_location: label })
      .eq('token', token)

    if (trackErr) console.error('[resolve-email-geo] tracking label update failed:', trackErr)
    else labelled++
  }

  return NextResponse.json({
    ok: true,
    attempted: pending.length,
    uniqueIps: uniqueIps.length,
    resolved,
    labelled,
  })
}
