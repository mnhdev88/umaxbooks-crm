/**
 * Resolving "the sales manager responsible for this lead".
 *
 * The hierarchy is leads.assigned_agent_id → profiles.manager_id (067). But
 * manager_id is only ever persisted for the sales_agent role — create-user and
 * update-user both null it for everyone else — so a lead assigned to an `agent`
 * or an admin has no resolvable manager. In that case we fall back to every
 * sales_manager, the same way the audit-note approval flow does, so the
 * notification is never silently dropped.
 *
 * Both helpers take a Supabase client rather than making one, so the same code
 * serves browser components (RLS, the acting user) and cron routes (service
 * role). Callers are responsible for removing themselves from the recipient
 * list — a developer submitting their own work shouldn't ping themselves.
 */

type MinimalClient = {
  from: (table: string) => any
}

/** Every sales_manager in the system. The fallback when the hierarchy is unset. */
async function allSalesManagers(supabase: MinimalClient): Promise<string[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'sales_manager')
  return (data || []).map((m: any) => m.id)
}

/**
 * The manager(s) to notify about a lead, given the agent it's assigned to.
 * Returns [] only when there are no sales managers at all.
 */
export async function managersForAgent(
  supabase: MinimalClient,
  assignedAgentId: string | null | undefined
): Promise<string[]> {
  if (!assignedAgentId) return allSalesManagers(supabase)

  const { data: agent } = await supabase
    .from('profiles')
    .select('manager_id')
    .eq('id', assignedAgentId)
    .maybeSingle()

  if (agent?.manager_id) return [agent.manager_id]
  return allSalesManagers(supabase)
}

/** Same, starting from a lead id — saves callers a lookup they usually don't have. */
export async function managersForLead(
  supabase: MinimalClient,
  leadId: string
): Promise<string[]> {
  const { data: lead } = await supabase
    .from('leads')
    .select('assigned_agent_id')
    .eq('id', leadId)
    .maybeSingle()

  return managersForAgent(supabase, lead?.assigned_agent_id)
}

export interface ManagerNotice {
  title: string
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  link?: string | null
}

/**
 * Notify the manager(s) responsible for a lead. Best-effort by design: a demo
 * submit must never fail because a notification insert did, which is the same
 * stance on_new_message takes in the DB.
 *
 * `exclude` drops the actor so nobody is notified of their own action — relevant
 * when a manager is also the assigned agent on a lead.
 */
export async function notifyLeadManagers(
  supabase: MinimalClient,
  leadId: string,
  notice: ManagerNotice,
  exclude?: string | null
): Promise<number> {
  try {
    const ids = new Set(await managersForLead(supabase, leadId))
    if (exclude) ids.delete(exclude)
    if (!ids.size) return 0

    const { error } = await supabase.from('notifications').insert(
      [...ids].map((user_id) => ({
        user_id,
        lead_id: leadId,
        title: notice.title,
        message: notice.message,
        type: notice.type || 'info',
        link: notice.link === undefined ? `/leads/${leadId}` : notice.link,
      }))
    )
    if (error) {
      console.error('[notify/managers] insert failed:', error.message)
      return 0
    }
    return ids.size
  } catch (e) {
    console.error('[notify/managers] unexpected failure:', e)
    return 0
  }
}
