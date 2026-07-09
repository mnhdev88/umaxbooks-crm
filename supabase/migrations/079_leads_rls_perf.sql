-- 079_leads_rls_perf.sql
-- PERFORMANCE: the leads table has 6 permissive SELECT policies (plus insert/
-- update/delete). Postgres ORs all SELECT policies together and evaluates them
-- ONCE PER ROW. Each policy called auth.uid() / get_my_role() unwrapped, so
-- those re-ran for every row scanned (1,345 rows -> ~8k function calls/query).
-- Measured: the bare `count(*) where status<>'Live'` is ~2ms, but under RLS as
-- `authenticated` it was ~1,600ms. This migration removes that overhead WITHOUT
-- changing who can see/do what.
--
-- Two techniques, both from Supabase's RLS performance guide:
--   1. Wrap auth.uid()/get_my_role() in a scalar subquery `(select …)`. Postgres
--      then evaluates them once as an InitPlan and reuses the value for all rows.
--   2. Replace the per-row, per-row-argument manages_agent(assigned_agent_id)
--      with a no-argument set-returning helper used as `IN (select …)`. The
--      subquery is uncorrelated, so it runs once per query. It stays SECURITY
--      DEFINER so it bypasses profiles RLS exactly like manages_agent() did.
--
-- Every policy below is a semantic no-op vs. what pg_policies currently shows —
-- only the evaluation cost changes. Safe to re-run.

-- ── 1. Set-returning, once-per-query replacement for manages_agent() ────────
-- Returns the ids of every agent the CURRENT user manages. SECURITY DEFINER +
-- STABLE so it bypasses profiles RLS (same as manages_agent) and is cached for
-- the statement. Uses idx_profiles_manager_id (migration 067).
CREATE OR REPLACE FUNCTION my_managed_agent_ids()
RETURNS SETOF uuid
LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT id FROM profiles WHERE manager_id = auth.uid()
$$;

-- ── 2. SELECT policies ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all leads" ON leads;
CREATE POLICY "Admins can view all leads"
  ON leads FOR SELECT USING (
    (select get_my_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Agents can view assigned or unassigned leads" ON leads;
CREATE POLICY "Agents can view assigned or unassigned leads"
  ON leads FOR SELECT USING (
    (select get_my_role()) = ANY (ARRAY['agent','sales_agent'])
    AND (assigned_agent_id IS NULL OR assigned_agent_id = (select auth.uid()))
  );

-- Guarded with the (cached) role check first so the correlated EXISTS only runs
-- for client-role users, never during an admin/agent full scan.
DROP POLICY IF EXISTS "Clients can view their own lead" ON leads;
CREATE POLICY "Clients can view their own lead"
  ON leads FOR SELECT USING (
    (select get_my_role()) = 'client'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid())
        AND profiles.role = 'client'
        AND profiles.lead_id = leads.id
    )
  );

DROP POLICY IF EXISTS "Developers can view relevant leads" ON leads;
CREATE POLICY "Developers can view relevant leads"
  ON leads FOR SELECT USING (
    (select get_my_role()) = 'developer'
    AND status = ANY (ARRAY['Contacted','Audit Ready','Demo Scheduled',
                            'Demo Done','Revision','Live','Completed'])
  );

DROP POLICY IF EXISTS "Managers can view their team's leads" ON leads;
CREATE POLICY "Managers can view their team's leads"
  ON leads FOR SELECT USING (
    (select get_my_role()) = 'sales_manager'
    AND (
      assigned_agent_id = (select auth.uid())
      OR assigned_agent_id IS NULL
      OR assigned_agent_id IN (SELECT my_managed_agent_ids())
    )
  );

DROP POLICY IF EXISTS "Users can view leads they created" ON leads;
CREATE POLICY "Users can view leads they created"
  ON leads FOR SELECT USING (
    created_by = (select auth.uid())
  );

-- ── 3. INSERT policy ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agents and admins can insert leads" ON leads;
CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT WITH CHECK (
    (select get_my_role()) = ANY (ARRAY['admin','agent','sales_agent','sales_manager'])
  );

-- ── 4. UPDATE policies ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Agents can update their own leads" ON leads;
CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE USING (
    (select get_my_role()) = 'admin'
    OR (
      (select get_my_role()) = ANY (ARRAY['agent','sales_agent'])
      AND assigned_agent_id = (select auth.uid())
    )
    OR (
      (select get_my_role()) = 'sales_manager'
      AND (
        assigned_agent_id = (select auth.uid())
        OR assigned_agent_id IS NULL
        OR assigned_agent_id IN (SELECT my_managed_agent_ids())
      )
    )
  );

DROP POLICY IF EXISTS "Developers can update Contacted leads" ON leads;
CREATE POLICY "Developers can update Contacted leads"
  ON leads FOR UPDATE
  USING (
    (select get_my_role()) = 'developer' AND status = 'Contacted'
  )
  WITH CHECK (
    (select get_my_role()) = 'developer'
    AND status = ANY (ARRAY['Contacted','Audit Ready'])
  );

-- ── 5. DELETE policy ───────────────────────────────────────────────────────
-- Uncorrelated EXISTS (no reference to leads) — already once-per-query; just
-- wrap auth.uid() to match the rest.
DROP POLICY IF EXISTS "Admins can delete leads" ON leads;
CREATE POLICY "Admins can delete leads"
  ON leads FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (select auth.uid()) AND profiles.role = 'admin'
    )
  );

-- Refresh planner stats (does not need VACUUM's exclusive lock).
ANALYZE leads;
