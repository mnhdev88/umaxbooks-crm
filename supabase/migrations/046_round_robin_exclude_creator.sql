-- Decouple lead creation from self-assignment.
--
-- Requirement: when any user saves a lead it is stored with created_by = that user,
-- but it must NEVER be auto-assigned back to its creator. If the creator manually
-- chose a sales agent, respect it; otherwise round-robin assigns it to a sales agent
-- OTHER than the creator.
--
-- Before this, a creator who is themselves in the sales pool could get their own
-- newly-created lead handed back by the rotation. Here we pass the creator into the
-- picker and skip them.

-- Drop the old zero-arg version so the new defaulted-arg version isn't an ambiguous
-- overload (pick_round_robin_agent() would otherwise match both).
DROP FUNCTION IF EXISTS pick_round_robin_agent();

CREATE OR REPLACE FUNCTION pick_round_robin_agent(exclude_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  last_id   UUID;
  last_rank INT;
  next_id   UUID;
BEGIN
  SELECT last_agent_id INTO last_id
  FROM round_robin_state
  WHERE id = 1
  FOR UPDATE;

  -- Rank of the last-assigned agent within the active pool (0 if unknown/inactive).
  SELECT COALESCE(id, 0) INTO last_rank
  FROM round_robin_agents
  WHERE profile_id = last_id AND is_active = TRUE;

  -- Next active agent after that rank, skipping the creator.
  SELECT profile_id INTO next_id
  FROM round_robin_agents
  WHERE is_active = TRUE
    AND id > COALESCE(last_rank, 0)
    AND (exclude_id IS NULL OR profile_id <> exclude_id)
  ORDER BY id ASC
  LIMIT 1;

  -- Wrapped past the end (or last agent removed) -> start from the first eligible.
  IF next_id IS NULL THEN
    SELECT profile_id INTO next_id
    FROM round_robin_agents
    WHERE is_active = TRUE
      AND (exclude_id IS NULL OR profile_id <> exclude_id)
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  -- No eligible agent (e.g. the creator is the only one in the pool) -> leave
  -- the lead unassigned rather than assigning it back to the creator.
  IF next_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE round_robin_state SET last_agent_id = next_id WHERE id = 1;
  RETURN next_id;
END;
$$;

-- Trigger function now passes the creator so the picker can exclude them.
-- Still only fires when no agent was set, so manual assignments are respected.
CREATE OR REPLACE FUNCTION auto_assign_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    NEW.assigned_agent_id := pick_round_robin_agent(NEW.created_by);
  END IF;
  RETURN NEW;
END;
$$;
