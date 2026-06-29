-- Scope who can read activity_logs.
--
-- Previously SELECT was open to ANY authenticated user, so a sales_agent could read
-- every other agent's activity. Replace it with a scoped policy:
--   * admin / legacy 'agent'  -> everything (they can already see all leads, so the
--                                lead-visibility clause below matches every row)
--   * your own actions        -> always visible (user_id = auth.uid())
--   * sales_manager           -> their team's actions (manages_agent(user_id))
--   * anyone                  -> activity tied to a lead they can see
--
-- The lead-visibility clause (EXISTS over leads, which is itself RLS-scoped) is what
-- keeps the per-lead Activity tab working for everyone: you see the full history of any
-- lead you can open. manages_agent() / get_my_role() are SECURITY DEFINER, so this
-- doesn't recurse on profiles. INSERT policy is unchanged.

DROP POLICY IF EXISTS "Authenticated users can view activity logs" ON activity_logs;
DROP POLICY IF EXISTS "Scoped activity log visibility" ON activity_logs;

CREATE POLICY "Scoped activity log visibility"
  ON activity_logs FOR SELECT USING (
    get_my_role() = 'admin'
    OR user_id = auth.uid()
    OR (get_my_role() = 'sales_manager' AND manages_agent(user_id))
    OR EXISTS (SELECT 1 FROM leads l WHERE l.id = activity_logs.lead_id)
  );
