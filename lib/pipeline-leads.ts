import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Only the columns the kanban board actually reads (LeadCard, KanbanColumn,
 * KanbanBoard search / sort / reassign, ComposeModal). `*` pulled all 54 lead
 * columns — 11.7 MB for ~6.8k leads vs ~3.5 MB with this list. If a card starts
 * showing a new field, add it here.
 */
const BASE_COLUMNS =
  'id, name, company_name, status, lead_number, gmb_review_rating, email, alt_emails, phone, ' +
  'assigned_agent_id, created_at, updated_at, ' +
  'assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name)'

export const PIPELINE_SELECT              = `${BASE_COLUMNS}, follow_ups(scheduled_at, status)`
export const PIPELINE_SELECT_NO_FOLLOWUPS = BASE_COLUMNS

const BATCH = 1000 // PostgREST's max rows per response

/**
 * Load every matching lead. PostgREST caps responses at 1000 rows, so this counts
 * first and then fetches all the 1000-row pages *in parallel* (the old loop fetched
 * them one after another — 7 round trips back to back). The `id` tiebreaker keeps
 * page boundaries stable so no lead is duplicated or skipped between pages.
 *
 * `filter` applies the same role scoping to both the count and the page queries.
 */
export async function fetchAllPipelineLeads<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  select: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics vary per call
  filter: (q: any) => any = (q) => q,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const { count, error: countError } = await filter(
    supabase.from('leads').select('id', { count: 'exact', head: true }),
  )
  if (countError) return { data: [], error: countError }

  const pages = Math.max(1, Math.ceil((count ?? 0) / BATCH))
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      filter(
        supabase
          .from('leads')
          .select(select)
          .order('updated_at', { ascending: false })
          .order('id', { ascending: true })
          .range(p * BATCH, p * BATCH + BATCH - 1),
      ),
    ),
  )

  const data: T[] = []
  for (const r of results as { data: T[] | null; error: { message: string } | null }[]) {
    if (r.error) return { data, error: r.error }
    data.push(...(r.data ?? []))
  }
  return { data, error: null }
}

/** Focus refetches are skipped if the board was refreshed more recently than this. */
export const FOCUS_REFRESH_MIN_MS = 60_000
