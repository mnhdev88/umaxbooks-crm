-- Demo build tracking: make "is anyone actually building this?" answerable.
--
-- Before: a developer's first observable act was the submit. demos rows are only
-- created at submit time (DevDemoTab.saveAndSubmit), and demos has no status
-- column, so nothing distinguished "scheduled 4 days ago, untouched" from
-- "scheduled 4 days ago, nearly done". Sales managers received no demo build
-- notification at all.
--
-- After: a developer clicks "Start Build", which both claims the demo (the first
-- point in the lifecycle where a specific developer attaches to a specific lead —
-- the queue is otherwise shared and unfiltered) and notifies the responsible
-- sales manager. A stall cron flags builds that never start or never finish.

-- ── Build state, one active row per lead ────────────────────────────────────
CREATE TABLE IF NOT EXISTS demo_builds (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id          UUID NOT NULL REFERENCES leads(id)    ON DELETE CASCADE,
  developer_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'building',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at     TIMESTAMPTZ,
  -- Set when the stall cron alerts, so a stuck build is reported once rather
  -- than on every tick. Cleared on resubmit so a second stall can still fire.
  stall_alerted_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE demo_builds DROP CONSTRAINT IF EXISTS demo_builds_status_check;
ALTER TABLE demo_builds ADD CONSTRAINT demo_builds_status_check
  CHECK (status IN ('building', 'submitted'));

-- One build row per lead. The claim is an upsert on this constraint, which is
-- what makes "two developers click Start at once" resolve to a single winner
-- instead of two rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_demo_builds_lead ON demo_builds(lead_id);
CREATE INDEX IF NOT EXISTS idx_demo_builds_developer ON demo_builds(developer_id);
-- Drives the stall cron's scan.
CREATE INDEX IF NOT EXISTS idx_demo_builds_status_started ON demo_builds(status, started_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE demo_builds ENABLE ROW LEVEL SECURITY;

-- Everyone who works a lead needs to see build state: the manager and agent to
-- know where it stands, other developers to see it's already claimed.
DROP POLICY IF EXISTS "Staff can read demo builds" ON demo_builds;
CREATE POLICY "Staff can read demo builds"
  ON demo_builds FOR SELECT USING (
    (select get_my_role()) IN ('admin', 'agent', 'sales_agent', 'sales_manager', 'developer')
  );

-- A developer claims for themselves; admins can correct a mis-claim.
DROP POLICY IF EXISTS "Developers can start their own builds" ON demo_builds;
CREATE POLICY "Developers can start their own builds"
  ON demo_builds FOR INSERT WITH CHECK (
    (developer_id = (select auth.uid()) AND (select get_my_role()) = 'developer')
    OR (select get_my_role()) = 'admin'
  );

-- The claimant advances their own build to 'submitted'. Admins can reassign or
-- reset a build whose developer went away.
DROP POLICY IF EXISTS "Developers can update their own builds" ON demo_builds;
CREATE POLICY "Developers can update their own builds"
  ON demo_builds FOR UPDATE USING (
    developer_id = (select auth.uid()) OR (select get_my_role()) = 'admin'
  ) WITH CHECK (
    developer_id = (select auth.uid()) OR (select get_my_role()) = 'admin'
  );

DROP POLICY IF EXISTS "Admins can delete demo builds" ON demo_builds;
CREATE POLICY "Admins can delete demo builds"
  ON demo_builds FOR DELETE USING ((select get_my_role()) = 'admin');

-- ── Keep updated_at honest ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_demo_builds_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demo_builds_updated_at ON demo_builds;
CREATE TRIGGER trg_demo_builds_updated_at
  BEFORE UPDATE ON demo_builds
  FOR EACH ROW EXECUTE FUNCTION touch_demo_builds_updated_at();

-- ── Backfill: already-submitted demos count as submitted ────────────────────
-- Without this every historical demo reads "Not started", and the stall cron
-- would alert on a burst of long-finished work on its first tick.
INSERT INTO demo_builds (lead_id, developer_id, status, started_at, submitted_at)
SELECT DISTINCT ON (d.lead_id)
  d.lead_id, d.developer_id, 'submitted', d.created_at, d.created_at
FROM demos d
WHERE d.developer_id IS NOT NULL
ORDER BY d.lead_id, d.created_at DESC
ON CONFLICT (lead_id) DO NOTHING;

COMMENT ON TABLE demo_builds IS
  'Tracks demo build progress (098). A developer claims a lead on Start Build; the row advances to submitted on approval submit. Also the only per-developer claim in the otherwise-shared dev queue.';
COMMENT ON COLUMN demo_builds.stall_alerted_at IS
  'Stamped by the demo-build-stalled cron so each stuck build alerts once, not every tick.';
