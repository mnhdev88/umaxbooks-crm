-- Restrict lead visibility: agents only see leads assigned to them (or unassigned).
-- Admins continue to see all leads.

DROP POLICY IF EXISTS "Agents and admins can view all leads" ON leads;
DROP POLICY IF EXISTS "Admins can view all leads" ON leads;
DROP POLICY IF EXISTS "Agents can view assigned or unassigned leads" ON leads;

-- Admins see everything
CREATE POLICY "Admins can view all leads"
  ON leads FOR SELECT USING (
    get_my_role() = 'admin'
  );

-- Agents (and sales_agents) see only their assigned leads, plus unassigned ones
CREATE POLICY "Agents can view assigned or unassigned leads"
  ON leads FOR SELECT USING (
    get_my_role() IN ('agent', 'sales_agent')
    AND (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
  );
