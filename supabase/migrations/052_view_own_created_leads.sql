-- Let agents see leads they created, even after round-robin assigns the lead to
-- a different (pool) agent.
--
-- Context: auto_assign_lead (046_round_robin_exclude_creator) deliberately hands
-- every new lead to a pool agent OTHER than the creator, and the visibility policy
-- (011_leads_agent_visibility) only shows an agent leads assigned to them or
-- unassigned. Net effect: a lead vanished from its creator's list the instant they
-- saved it. This adds a creator-scoped SELECT grant so the creator keeps visibility
-- without changing lead distribution.

CREATE POLICY "Users can view leads they created"
  ON leads FOR SELECT
  USING ( created_by = auth.uid() );
