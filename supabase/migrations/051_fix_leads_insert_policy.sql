-- Fix: agents could not create leads — "new row violates row-level security
-- policy for table leads".
--
-- Root cause: the cloud DB had drifted to an INSERT policy whose WITH CHECK
-- additionally required the new row's assigned_agent_id to be the inserting
-- user. The round-robin auto-assign trigger (043_round_robin_lead_assignment)
-- runs BEFORE INSERT and overwrites a NULL assigned_agent_id with a *pool*
-- agent (Eva/Anna/Roland), so a non-pool agent's row ended up assigned to
-- someone else and failed the check. The two features are incompatible.
--
-- This restores the intended role-only INSERT policy (matches migration 014):
-- creation is gated purely on role, and the trigger is free to assign the lead
-- to any pool agent.

DROP POLICY IF EXISTS "Agents and admins can insert leads" ON leads;

CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT
  WITH CHECK ( get_my_role() IN ('admin', 'agent', 'sales_agent') );
