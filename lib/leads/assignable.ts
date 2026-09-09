import { Profile } from '@/types'

/**
 * The agents a user may assign/reassign a lead to, for populating assignment dropdowns.
 *
 * - sales_manager: their own team (profiles.manager_id === them) plus themselves, mirroring
 *   the RLS in migration 067 (a manager may set assigned_agent_id to an agent they manage or
 *   to auth.uid()). Anything outside the team would fail the DB WITH CHECK, so we don't offer it.
 * - everyone else (admin, agent, sales_agent): all sales agents except self — unchanged.
 *
 * For the self option to appear, the manager's own profile must be present in `agents`
 * (the page/board fetches include the sales_manager role).
 *
 * `allowSelf` opts the caller into offering the current user as a target. It is used by the
 * Add Lead form so a sales agent creating a lead can keep it, and is deliberately NOT used by
 * the Kanban assign menu or bulk assign — there, self-assignment would let an agent claim any
 * unassigned lead they can see rather than only the ones they entered. Note the round-robin
 * trigger (migration 046) still hands an *unassigned* new lead to someone else; keeping it is
 * an explicit choice in the dropdown.
 */
export function assignableAgents(
  agents: Profile[],
  userRole: string | null | undefined,
  userId: string | null | undefined,
  { allowSelf = false }: { allowSelf?: boolean } = {},
): Profile[] {
  if (userRole === 'sales_manager') {
    return agents.filter((a) => a.manager_id === userId || a.id === userId)
  }
  const self = allowSelf && (userRole === 'sales_agent' || userRole === 'agent')
    ? agents.find((a) => a.id === userId)
    : undefined

  const others = agents.filter((a) => a.role === 'sales_agent' && a.id !== userId)

  // Self first, so "keep it" is the obvious choice rather than one name among many.
  // Admins/managers are unaffected: an admin is not in the sales pool, and the manager
  // branch above already includes them.
  return self && !others.some((a) => a.id === self.id) ? [self, ...others] : others
}
