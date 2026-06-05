-- True round-robin rotation for lead auto-assignment.
--
-- Problem: pick_round_robin_agent() (migration 043) ordered by COUNT(leads) ASC,
-- i.e. "least-loaded", not a real rotation. When a sales agent in the pool created
-- leads, they were usually the least-loaded at that moment, so the function kept
-- handing their own new leads back to them. Admins (not in the pool) didn't see this,
-- which is why auto-assignment looked correct for admins but self-assigned for agents.
--
-- Fix: rotate Eva -> Anna -> Roland -> Eva ... using a persistent cursor, independent
-- of current lead counts and of who created the lead. The BEFORE INSERT trigger
-- (trg_auto_assign_lead) is unchanged: it still only round-robins when
-- assigned_agent_id IS NULL, so manual assignments are still respected.

-- ── 1. Rotation cursor (single row) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS round_robin_state (
  id            INT  PRIMARY KEY DEFAULT 1,
  last_agent_id UUID REFERENCES profiles(id),
  CONSTRAINT round_robin_state_single_row CHECK (id = 1)
);

INSERT INTO round_robin_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE round_robin_state ENABLE ROW LEVEL SECURITY;

-- Read-only to authenticated users; the function updates it with definer rights.
CREATE POLICY "Authenticated users read round robin state"
  ON round_robin_state FOR SELECT
  TO authenticated
  USING (TRUE);

-- ── 2. Rotating picker ──────────────────────────────────────────────────────
-- Returns the next active agent after last_agent_id in insertion order (cyclic).
-- FOR UPDATE on the cursor row serializes concurrent inserts so two leads never
-- land on the same agent by racing.
CREATE OR REPLACE FUNCTION pick_round_robin_agent()
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
AS $$
DECLARE
  last_id UUID;
  last_rank INT;
  next_id UUID;
BEGIN
  SELECT last_agent_id INTO last_id
  FROM round_robin_state
  WHERE id = 1
  FOR UPDATE;

  -- Rank of the last-assigned agent within the active pool (0 if unknown/inactive).
  SELECT COALESCE(id, 0) INTO last_rank
  FROM round_robin_agents
  WHERE profile_id = last_id AND is_active = TRUE;

  -- Next active agent after that rank.
  SELECT profile_id INTO next_id
  FROM round_robin_agents
  WHERE is_active = TRUE AND id > COALESCE(last_rank, 0)
  ORDER BY id ASC
  LIMIT 1;

  -- Wrapped past the end (or last agent was removed) -> start from the first.
  IF next_id IS NULL THEN
    SELECT profile_id INTO next_id
    FROM round_robin_agents
    WHERE is_active = TRUE
    ORDER BY id ASC
    LIMIT 1;
  END IF;

  -- Pool empty -> leave the lead unassigned.
  IF next_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE round_robin_state SET last_agent_id = next_id WHERE id = 1;
  RETURN next_id;
END;
$$;
