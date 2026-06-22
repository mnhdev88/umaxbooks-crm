-- Replace Eva & Anna with new sales agent Mark Hill.
--
-- Two things change, both manual (no trigger fires on UPDATE — the round-robin
-- auto-assign in 043/044 only runs BEFORE INSERT when assigned_agent_id IS NULL):
--   1. Existing leads: every lead assigned to Eva or Anna moves to Mark.
--   2. Future leads: Eva & Anna leave the round-robin pool, Mark joins it, and
--      the rotation cursor is repointed off them.
--
-- Eva/Anna are matched by their known emails (see migration 043). Mark is matched
-- by full_name since he was created in the cloud DB, not seeded here. If his email
-- is known, swap the lookup to email for a tighter match.

DO $$
DECLARE
  eva_id    UUID;
  anna_id   UUID;
  roland_id UUID;
  mark_id   UUID;
  moved     INT;
BEGIN
  SELECT id INTO eva_id    FROM profiles WHERE email = 'eva@noveliotech.com';
  SELECT id INTO anna_id   FROM profiles WHERE email = 'anna@noveliotech.com';
  SELECT id INTO roland_id FROM profiles WHERE email = 'roland@noveliotech.com';

  SELECT id INTO mark_id FROM profiles WHERE lower(full_name) = lower('Mark Hill');

  -- Fail loudly rather than orphaning leads onto a NULL agent.
  IF mark_id IS NULL THEN
    RAISE EXCEPTION 'Mark Hill profile not found — aborting reassignment';
  END IF;

  -- 1. Move existing leads off Eva/Anna onto Mark.
  UPDATE leads
  SET    assigned_agent_id = mark_id,
         updated_at = NOW()
  WHERE  assigned_agent_id IN (eva_id, anna_id)
    AND  assigned_agent_id IS NOT NULL;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Reassigned % lead(s) from Eva/Anna to Mark Hill', moved;

  -- 2a. Remove Eva, Anna & Roland from the active rotation (rows kept for history).
  --     Roland's existing leads stay with him — only the rotation changes.
  UPDATE round_robin_agents
  SET    is_active = FALSE
  WHERE  profile_id IN (eva_id, anna_id, roland_id);

  -- 2b. Add Mark to the rotation (or reactivate if a row already exists).
  INSERT INTO round_robin_agents (profile_id, is_active)
  VALUES (mark_id, TRUE)
  ON CONFLICT (profile_id) DO UPDATE SET is_active = TRUE;

  -- 2c. Repoint the rotation cursor if it still references Eva/Anna, so the next
  --     pick doesn't start its search from a now-inactive agent.
  UPDATE round_robin_state
  SET    last_agent_id = mark_id
  WHERE  id = 1
    AND  (last_agent_id IN (eva_id, anna_id, roland_id) OR last_agent_id IS NULL);
END $$;
