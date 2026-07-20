/**
 * Outbound caller-ID selection for the human dialer.
 *
 * One number placing ~170 cold calls/day is what got the original TWILIO_CALLER_ID
 * labelled "Spam Likely" by the carrier analytics engines. This picks a from-number
 * per call so volume spreads across the pool under per-number daily caps, and
 * prefers a number whose area code matches the lead's ("local presence"), which
 * lifts pickup independently of the spam label.
 *
 * Selection order, most to least important:
 *   1. Registered numbers beat unregistered ones — an unregistered number gets
 *      labelled no matter how light its volume, so we spend it last.
 *   2. Under its daily cap beats over it.
 *   3. Area-code match with the destination beats no match.
 *   4. Fewest calls so far today, so the pool drains evenly.
 *
 * A call is NEVER blocked for want of a number: if every number is capped we pick
 * the least-used one anyway and log it, and if the pool is empty we fall back to
 * the TWILIO_CALLER_ID env var (the pre-pool behaviour).
 *
 * See supabase/migrations/091_caller_number_pool.sql.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getReportDayConfig } from '@/lib/report-config'
import { reportingDate, reportingDayWindow } from '@/lib/reporting-day'

export interface CallerNumber {
  id: string
  phone_number: string
  label: string | null
  area_code: string | null
  daily_cap: number
  is_active: boolean
  registered: boolean
}

export interface CallerSelection {
  /** E.164 number to use as the caller ID. */
  from: string
  /** Why this one — logged on the TwiML route, handy when pickup drops. */
  reason: 'area-match' | 'least-used' | 'all-capped' | 'env-fallback'
}

/** Area code of a US E.164 number, or null for anything else. Mirrors the generated column in 091. */
export function areaCodeOf(e164: string): string | null {
  const m = /^\+1(\d{3})\d{7}$/.exec(e164.trim())
  return m ? m[1] : null
}

/**
 * Pick the caller ID for a call to `toE164`. Uses the service client (this runs from
 * the unauthenticated TwiML webhook, which has no session). Never throws — any
 * failure degrades to the env fallback so a config problem can't kill the dialer.
 */
export async function selectCallerNumber(
  supabase: SupabaseClient,
  toE164: string
): Promise<CallerSelection> {
  const envFallback = process.env.TWILIO_CALLER_ID || ''

  try {
    const { data, error } = await supabase
      .from('caller_numbers')
      .select('id, phone_number, label, area_code, daily_cap, is_active, registered')
      .eq('is_active', true)

    if (error) throw error

    const pool = (data || []) as CallerNumber[]
    if (pool.length === 0) return { from: envFallback, reason: 'env-fallback' }

    // Calls placed on each number so far in the current reporting day. The business
    // day starts at a configurable hour (default 06:00 IST), NOT server midnight, so
    // caps line up with how the team's day is measured everywhere else.
    const cfg = await getReportDayConfig(supabase)
    const { fromISO, toISO } = reportingDayWindow(reportingDate(new Date(), cfg), cfg)

    const { data: todayRows } = await supabase
      .from('voice_calls')
      .select('from_number')
      .eq('provider', 'twilio')
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .not('from_number', 'is', null)

    const used = new Map<string, number>()
    for (const r of (todayRows || []) as { from_number: string }[]) {
      used.set(r.from_number, (used.get(r.from_number) || 0) + 1)
    }

    const wantArea = areaCodeOf(toE164)

    // Rank ascending — the first entry after sorting is the pick.
    const ranked = pool
      .map((n) => {
        const count = used.get(n.phone_number) || 0
        return {
          n,
          count,
          unregistered: n.registered ? 0 : 1,
          overCap: count >= n.daily_cap ? 1 : 0,
          areaMiss: wantArea && n.area_code === wantArea ? 0 : 1,
        }
      })
      .sort(
        (a, b) =>
          a.unregistered - b.unregistered ||
          a.overCap - b.overCap ||
          a.areaMiss - b.areaMiss ||
          a.count - b.count ||
          // Stable final tie-break so the choice is deterministic across replicas.
          a.n.phone_number.localeCompare(b.n.phone_number)
      )

    const pick = ranked[0]
    const allCapped = ranked.every((r) => r.overCap === 1)

    if (allCapped) {
      console.warn(
        '[caller-numbers] every number is over its daily cap — placing anyway on',
        pick.n.phone_number,
        '· add numbers or raise caps in Settings → Caller Numbers'
      )
      return { from: pick.n.phone_number, reason: 'all-capped' }
    }

    return {
      from: pick.n.phone_number,
      reason: pick.areaMiss === 0 ? 'area-match' : 'least-used',
    }
  } catch (e) {
    console.error('[caller-numbers] selection failed, falling back to TWILIO_CALLER_ID', e)
    return { from: envFallback, reason: 'env-fallback' }
  }
}
