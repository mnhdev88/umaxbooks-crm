-- 075_kpi_user_overrides.sql
-- Per-user KPI scorecard targets/weights, layered over the global defaults.
--
-- kpi_scorecard_config (073) holds one org-wide Target/Weightage per KPI. Some
-- agents/managers need different numbers (e.g. a manager isn't expected to make
-- 50 calls/day), so this adds an *override* table: a row here replaces the
-- global target/weightage/active for that (user, KPI); KPIs without a row keep
-- inheriting the global config, so tuning a global default still flows to
-- everyone who wasn't customised. The save API deletes rows that match the
-- global values again, which is also how "Reset to defaults" works.

CREATE TABLE IF NOT EXISTS kpi_scorecard_user_overrides (
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kpi_key    TEXT NOT NULL REFERENCES kpi_scorecard_config(kpi_key) ON DELETE CASCADE,
  target     NUMERIC NOT NULL DEFAULT 0,   -- same semantics as config: per_day targets scale by #days
  weightage  NUMERIC NOT NULL DEFAULT 0,   -- percent; the user's active weights should sum to 100
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kpi_key)
);

ALTER TABLE kpi_scorecard_user_overrides ENABLE ROW LEVEL SECURITY;
-- Same posture as kpi_scorecard_config: targets/weights aren't sensitive and
-- every authenticated user's scorecard needs them to compute scores. Writes go
-- through the service client in the team KPI API, which gates on
-- admin-or-the-agent's-manager, so no write policy here.
DROP POLICY IF EXISTS "Authenticated can read kpi user overrides" ON kpi_scorecard_user_overrides;
CREATE POLICY "Authenticated can read kpi user overrides"
  ON kpi_scorecard_user_overrides FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE kpi_scorecard_user_overrides IS
  'Per-user Target/Weightage/Active overrides for the KPI scorecard; absent rows inherit kpi_scorecard_config.';
