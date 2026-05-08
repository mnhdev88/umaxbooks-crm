-- Allow sales_agents to insert and update leads assigned to them.
-- Migration 005 added the role to the CHECK constraint but never updated the RLS policies.

-- Fix INSERT: let sales_agent create leads
DROP POLICY IF EXISTS "Agents and admins can insert leads" ON leads;

CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT WITH CHECK (
    get_my_role() IN ('admin', 'agent', 'sales_agent')
  );

-- Fix UPDATE: let sales_agent edit leads assigned to them (same as agent)
DROP POLICY IF EXISTS "Agents can update their own leads" ON leads;

CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE
  USING (
    get_my_role() = 'admin'
    OR (
      get_my_role() IN ('agent', 'sales_agent')
      AND assigned_agent_id = auth.uid()
    )
  );
