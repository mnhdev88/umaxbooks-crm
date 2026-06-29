-- Sales hierarchy: a 'sales_manager' role that owns a team of sales_agents.
-- Each sales_agent points to its manager via profiles.manager_id.
-- Managers can view + edit (and reassign) the leads of every agent they own,
-- plus their own. Plain agents are unchanged. Lead auto-assignment stays the
-- global round-robin — managers just gain visibility into whoever got the lead.

-- ── 1. Hierarchy link ──────────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_manager_id ON profiles(manager_id);

-- ── 2. New role ────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'agent', 'sales_agent', 'sales_manager', 'developer', 'client'));

-- ── 3. RLS helper: does the current user manage this agent? ─────────────────
-- SECURITY DEFINER avoids RLS recursion on profiles (same pattern as get_my_role()).
CREATE OR REPLACE FUNCTION manages_agent(agent UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = agent AND manager_id = auth.uid()
  )
$$;

-- ── 4. Lead visibility: managers see their team + own + unassigned ─────────
DROP POLICY IF EXISTS "Managers can view their team's leads" ON leads;
CREATE POLICY "Managers can view their team's leads"
  ON leads FOR SELECT USING (
    get_my_role() = 'sales_manager'
    AND (
      assigned_agent_id = auth.uid()
      OR assigned_agent_id IS NULL
      OR manages_agent(assigned_agent_id)
    )
  );

-- ── 5. Lead insert: let managers create leads too ──────────────────────────
DROP POLICY IF EXISTS "Agents and admins can insert leads" ON leads;
CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'agent', 'sales_agent', 'sales_manager')
  );

-- ── 6. Lead update: managers can edit + reassign within their team ─────────
DROP POLICY IF EXISTS "Agents can update their own leads" ON leads;
CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE USING (
    get_my_role() = 'admin'
    OR (
      get_my_role() IN ('agent', 'sales_agent')
      AND assigned_agent_id = auth.uid()
    )
    OR (
      get_my_role() = 'sales_manager'
      AND (
        assigned_agent_id = auth.uid()
        OR assigned_agent_id IS NULL
        OR manages_agent(assigned_agent_id)
      )
    )
  );
-- Note: no separate WITH CHECK is given, so Postgres reuses the USING clause to
-- validate the NEW row too. That keeps a manager's reassignments inside their own
-- team (target agent must be managed by them, themselves, or left unassigned).
