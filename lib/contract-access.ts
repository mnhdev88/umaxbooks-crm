import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who sees which contracts — the one answer used by the Contracts page and by the
 * cancel/resend actions, so a row you can see is exactly a row you can act on.
 *
 *   admin          → every contract
 *   sales_manager  → contracts on leads owned by them or their agents, or sent by them/their agents
 *   sales_agent    → contracts on leads assigned to them, or that they sent
 *   (both sales roles also see contracts on unassigned leads — see contractInScope)
 *
 * "Or sent by" covers a lead reassigned after the agreement went out: the rep who
 * sent it still needs to see whether it came back signed.
 *
 * Returns null for "no restriction" (admin), otherwise the owning user ids.
 */
export async function contractOwnerIds(
  service: SupabaseClient,
  profile: { id: string; role: string },
): Promise<string[] | null> {
  if (profile.role === 'admin') return null
  if (profile.role === 'sales_manager') {
    const { data } = await service.from('profiles').select('id').eq('manager_id', profile.id)
    return [profile.id, ...(data || []).map(p => p.id as string)]
  }
  if (profile.role === 'sales_agent') return [profile.id]
  return []
}

export const CONTRACT_PAGE_ROLES = ['admin', 'sales_manager', 'sales_agent']

/** Does this contract (with its lead's owner) fall inside the caller's scope? */
export function contractInScope(
  owners: string[] | null,
  c: { created_by: string | null; lead_owner: string | null },
): boolean {
  if (owners === null) return true
  // Unassigned leads are open to every sales role under leads RLS (migration 079), and
  // their Contract tab is too — so their contracts are in scope for everyone who has one.
  if (owners.length > 0 && !c.lead_owner) return true
  return (!!c.created_by && owners.includes(c.created_by))
    || (!!c.lead_owner && owners.includes(c.lead_owner))
}
