-- Round-robin auto-assignment for new leads
-- Agents in the pool are stored in round_robin_agents so they can be
-- added/removed without any code changes.

-- ── 1. Rotation pool table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS round_robin_agents (
  id         SERIAL PRIMARY KEY,
  profile_id UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id)
);

-- Admins can manage the pool; everyone can read it
ALTER TABLE round_robin_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage round robin agents"
  ON round_robin_agents FOR ALL
  TO authenticated
  USING    (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Authenticated users read round robin agents"
  ON round_robin_agents FOR SELECT
  TO authenticated
  USING (TRUE);

-- ── 2. Seed Eva, Anna, Roland ───────────────────────────────────────────────
INSERT INTO round_robin_agents (profile_id)
SELECT id FROM profiles
WHERE email IN ('eva@noveliotech.com', 'anna@noveliotech.com', 'roland@noveliotech.com')
ON CONFLICT (profile_id) DO NOTHING;

-- ── 3. Assignment function ──────────────────────────────────────────────────
-- Returns the active agent in the pool who currently has the fewest leads.
-- Ties are broken by round_robin_agents.id (insertion order) so the rotation
-- is deterministic: Eva → Anna → Roland → Eva … when all are equal.
CREATE OR REPLACE FUNCTION pick_round_robin_agent()
RETURNS UUID
LANGUAGE sql
VOLATILE
AS $$
  SELECT rra.profile_id
  FROM   round_robin_agents rra
  LEFT   JOIN leads l ON l.assigned_agent_id = rra.profile_id
  WHERE  rra.is_active = TRUE
  GROUP  BY rra.profile_id, rra.id
  ORDER  BY COUNT(l.id) ASC, rra.id ASC
  LIMIT  1;
$$;

-- ── 4. Trigger function ─────────────────────────────────────────────────────
-- Only assigns when no agent was already set (manual assignments are respected).
CREATE OR REPLACE FUNCTION auto_assign_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    NEW.assigned_agent_id := pick_round_robin_agent();
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Trigger ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_assign_lead ON leads;
CREATE TRIGGER trg_auto_assign_lead
  BEFORE INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_lead();
