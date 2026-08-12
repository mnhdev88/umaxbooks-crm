import type { SupabaseClient } from '@supabase/supabase-js'

export type ActivityMap = Record<string, { emailSent: boolean; callLogged: boolean }>

const EMAIL_ACTIONS = ['Email Sent to Client', 'Auto Follow-up Email Sent'] as const
const CALL_ACTION = 'Call Logged'
const TRACKED_ACTIONS = [...EMAIL_ACTIONS, CALL_ACTION]

/**
 * A UUID costs ~40 chars once comma-encoded, so 100 ids keeps the `in.(…)` filter near
 * 4 KB — comfortably inside what the gateway accepts. Pasting every Contacted lead into
 * one filter built a URL long enough to be rejected outright: the 400 came back without
 * CORS headers, so the browser reported it as a CORS failure and the real cause was
 * invisible. See the .in() URL-length note; same class of bug as the leads-scoping one.
 *
 * Batching also sidesteps PostgREST's 1000-row cap: ~1.8k Contacted leads carry ~3.4k
 * tracked log rows, so a single query would have silently truncated even if the URL fit.
 */
const CHUNK = 100

/**
 * Which Contacted leads have had an email sent / a call logged, for the pipeline badges.
 * Batched so the request URL can't outgrow the gateway limit no matter how many leads
 * are in play. Throws on failure — callers should surface it rather than silently
 * rendering every badge as "off", which is what the old swallowed error did.
 */
export async function fetchActivityFlags(
  supabase: SupabaseClient<any, any, any>,
  leadIds: string[],
): Promise<ActivityMap> {
  const map: ActivityMap = {}
  if (!leadIds.length) return map

  const chunks: string[][] = []
  for (let i = 0; i < leadIds.length; i += CHUNK) chunks.push(leadIds.slice(i, i + CHUNK))

  const results = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from('activity_logs')
        .select('lead_id, action')
        .in('lead_id', ids)
        .in('action', TRACKED_ACTIONS),
    ),
  )

  for (const { data, error } of results) {
    if (error) throw error
    for (const log of (data || []) as { lead_id: string; action: string }[]) {
      if (!map[log.lead_id]) map[log.lead_id] = { emailSent: false, callLogged: false }
      if ((EMAIL_ACTIONS as readonly string[]).includes(log.action)) map[log.lead_id].emailSent = true
      if (log.action === CALL_ACTION) map[log.lead_id].callLogged = true
    }
  }
  return map
}
