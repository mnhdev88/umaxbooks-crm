-- Let a sales_manager work a lead's sub-records the same way a sales_agent can:
-- schedule calls/appointments, log deals, audits, and revisions.
--
-- These tables' base "manage" policies are role-gated (admin/agent in the original
-- schema). Rather than edit those policies (which have drifted in production), we add
-- separate PERMISSIVE policies just for sales_manager. Postgres OR's permissive policies
-- together, so this purely *grants* the manager and can't affect existing roles.
--
-- Access is role-based (any lead), mirroring how sales_agent already works for these
-- tables. Notes (lead_contact_notes), follow_ups and activity_logs are already open to
-- any authenticated user, so no change is needed there.

DROP POLICY IF EXISTS "Sales managers can manage appointments" ON appointments;
CREATE POLICY "Sales managers can manage appointments"
  ON appointments FOR ALL
  USING (get_my_role() = 'sales_manager')
  WITH CHECK (get_my_role() = 'sales_manager');

DROP POLICY IF EXISTS "Sales managers can manage deals" ON deals;
CREATE POLICY "Sales managers can manage deals"
  ON deals FOR ALL
  USING (get_my_role() = 'sales_manager')
  WITH CHECK (get_my_role() = 'sales_manager');

DROP POLICY IF EXISTS "Sales managers can manage revisions" ON revisions;
CREATE POLICY "Sales managers can manage revisions"
  ON revisions FOR ALL
  USING (get_my_role() = 'sales_manager')
  WITH CHECK (get_my_role() = 'sales_manager');

DROP POLICY IF EXISTS "Sales managers can manage audits" ON audits;
CREATE POLICY "Sales managers can manage audits"
  ON audits FOR ALL
  USING (get_my_role() = 'sales_manager')
  WITH CHECK (get_my_role() = 'sales_manager');
