-- Allow agents/sales_agents to update unassigned leads (assigned_agent_id IS NULL).
-- Previously the policy only allowed updates on leads already assigned to them,
-- blocking the initial assignment of an unassigned lead.

DROP POLICY IF EXISTS "Agents can update their own leads" ON leads;

CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE
  USING (
    get_my_role() = 'admin'
    OR (
      get_my_role() IN ('agent', 'sales_agent')
      AND (assigned_agent_id = auth.uid() OR assigned_agent_id IS NULL)
    )
  );
