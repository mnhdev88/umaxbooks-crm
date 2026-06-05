-- One-time backfill: redistribute existing leads onto the sales pool via round-robin.
--
-- Scope (decided with the team):
--   * Only leads currently assigned to someone NOT in the active round_robin_agents
--     pool (e.g. admins, ex-agents, self-assigned via the old least-loaded bug),
--     plus leads with no agent at all.
--   * Leads already assigned to a pool member (Eva/Anna/Roland) are left untouched.
--   * Closed leads are skipped: Live, Completed, Closed Won, Lost, Disqualified.
--
-- Distribution is even round-robin in created_at order. Running this again is safe:
-- a second run finds no out-of-pool leads (everything is now on the pool), so it
-- becomes a no-op.

WITH pool AS (
  SELECT profile_id,
         ROW_NUMBER() OVER (ORDER BY id) - 1 AS pos,
         COUNT(*)     OVER ()                AS n
  FROM round_robin_agents
  WHERE is_active = TRUE
),
targets AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at, id) - 1 AS rn
  FROM leads
  WHERE status NOT IN ('Live','Completed','Closed Won','Lost','Disqualified')
    AND (
      assigned_agent_id IS NULL
      OR assigned_agent_id NOT IN (SELECT profile_id FROM round_robin_agents WHERE is_active = TRUE)
    )
),
assignment AS (
  SELECT t.id AS lead_id, p.profile_id
  FROM targets t
  JOIN pool p ON p.pos = t.rn % p.n
)
UPDATE leads l
SET assigned_agent_id = a.profile_id
FROM assignment a
WHERE l.id = a.lead_id;
