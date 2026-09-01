/**
 * Outbound caller-ID selection for the human dialer.
 *
 * One number placing ~170 cold calls/day is what got the original TWILIO_CALLER_ID
 * labelled "Spam Likely" by the carrier analytics engines. This picks a from-number
 * per call so volume spreads across the pool under per-number daily caps, and
 * prefers a number whose area code matches the lead's ("local presence"), which
 * lifts pickup independently of the spam label.
 *
 * Numbers flagged auto_rotate = FALSE (108) are skipped by this ranking entirely —
 * they stay in the agent's "Call from" dropdown for deliberate use, but the picker
 * never assigns them volume.
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
 * See supabase/migrations/091_caller_number_pool.sql and 108_caller_number_auto_rotate.sql.
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
  /** Whether the automatic ranking may spend this number (108). Manual picks ignore it. */
  auto_rotate: boolean
}

export interface CallerSelection {
  /** E.164 number to use as the caller ID. */
  from: string
  /** Why this one — logged on the TwiML route, handy when pickup drops. */
  reason: 'manual' | 'area-match' | 'least-used' | 'all-capped' | 'env-fallback'
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
 *
 * `preferredId` is the agent's "Call from" choice in the pre-call modal. It is an id,
 * never a number: the webhook it arrives on is public (Twilio-signature verified, but
 * a signed request can be replayed), so accepting a raw From would let a caller ID be
 * spoofed. Resolving the id against the active pool means the worst a bad value can do
 * is fall through to the automatic pick.
 *
 * A manual pick that is over its daily cap is honoured anyway, matching the automatic
 * path — a call is never blocked for want of a number, and the modal already warned
 * the agent the number was at cap.
 */
export async function selectCallerNumber(
  supabase: SupabaseClient,
  toE164: string,
  preferredId?: string
): Promise<CallerSelection> {
  const envFallback = process.env.TWILIO_CALLER_ID || ''

  try {
    const { data, error } = await supabase
      .from('caller_numbers')
      .select('id, phone_number, label, area_code, daily_cap, is_active, registered, auto_rotate')
      .eq('is_active', true)

    if (error) throw error

    const pool = (data || []) as CallerNumber[]
    if (pool.length === 0) return { from: envFallback, reason: 'env-fallback' }

    // Honour the agent's explicit choice, if it still resolves to an active number.
    // An id that's unknown, or belongs to a number deactivated since the modal loaded,
    // falls through to the ranking below rather than failing the call.
    if (preferredId) {
      const chosen = pool.find((n) => n.id === preferredId)
      if (chosen) return { from: chosen.phone_number, reason: 'manual' }
      console.warn('[caller-numbers] requested caller id is not in the active pool, auto-selecting', preferredId)
    }

    // Calls placed on each number so far in the current reporting day. The business
    // day starts at a configurable hour (default 06:00 IST), NOT server midnight, so
    // caps line up with how the team's day is measured everywhere else.
    const cfg = await getReportDayConfig(supabase)
    const { fromISO, toISO } = reportingDayWindow(reportingDate(new Date(), cfg), cfg)

    const { data: todayRows } = await supabase
      .from('voice_calls')
      .select('from_number')
      .eq('provider', 'twilio')
      // Inbound rows carry the lead's number in from_number, not ours — excluded so
      // a callback can never eat into a pool number's outbound cap.
      .eq('direction', 'outbound')
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .not('from_number', 'is', null)

    const used = new Map<string, number>()
    for (const r of (todayRows || []) as { from_number: string }[]) {
      used.set(r.from_number, (used.get(r.from_number) || 0) + 1)
    }

    const wantArea = areaCodeOf(toE164)

    // Rank ascending — the first entry after sorting is the pick.
    // Numbers flagged manual-only (auto_rotate = FALSE, 108) stay in `pool` so an agent's
    // explicit pick above still resolves, but the automatic ranking never reaches for
    // them. If that leaves nothing — every number manual-only — fall back to the whole
    // pool rather than the env number: a rotation-excluded number of ours still beats
    // dropping every call onto the single TWILIO_CALLER_ID this file exists to retire.
    const rotatable = pool.filter((n) => n.auto_rotate)
    if (rotatable.length === 0) {
      console.warn('[caller-numbers] every active number is manual-only — ranking the full pool instead')
    }

    const ranked = (rotatable.length > 0 ? rotatable : pool)
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
