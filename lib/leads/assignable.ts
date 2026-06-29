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
 */
export function assignableAgents(
  agents: Profile[],
  userRole: string | null | undefined,
  userId: string | null | undefined,
): Profile[] {
  if (userRole === 'sales_manager') {
    return agents.filter((a) => a.manager_id === userId || a.id === userId)
  }
  return agents.filter((a) => a.role === 'sales_agent' && a.id !== userId)
}
