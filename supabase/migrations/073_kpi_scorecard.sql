-- 073_kpi_scorecard.sql
-- Weighted funnel KPI scorecard for sales agents (TOFU / MOFU / BOFU / Learning).
--
-- The Reports page already exposes raw per-agent counts (leads, calls, demos,
-- deals) but no *grade*. This migration adds the two things a scorecard needs on
-- top of those counts:
--   1. kpi_scorecard_config — admin-editable Target + Weightage per KPI. Output %
--      = achieved / target; weighted score = weightage × output; the agent's
--      total score is the sum of weighted scores (weights sum to 100). Mirrors the
--      Novelio "US Sales Agent KPI Scorecard" spreadsheet.
--   2. kpi_manual_entries — capture for the two KPIs with no system event behind
--      them: "Proposals sent" (a count) and "Training / learning completion" (a %).
--
-- Achieved numbers for the automated KPIs are aggregated by report_kpi_scorecard
-- below; the API turns Target/Achieved into Output % and the weighted score.

-- ── Config: one row per KPI (admin-editable targets & weights) ───────────────
CREATE TABLE IF NOT EXISTS kpi_scorecard_config (
  kpi_key      TEXT PRIMARY KEY,
  stage        TEXT NOT NULL CHECK (stage IN ('TOFU','MOFU','BOFU','Learning')),
  label        TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT 'auto'     CHECK (source IN ('auto','manual')),
  unit         TEXT NOT NULL DEFAULT 'count'    CHECK (unit IN ('count','hours','percent')),
  target       NUMERIC NOT NULL DEFAULT 0,      -- per_day targets are multiplied by #days in range
  target_basis TEXT NOT NULL DEFAULT 'per_day'  CHECK (target_basis IN ('per_day','per_period')),
  weightage    NUMERIC NOT NULL DEFAULT 0,      -- percent; active rows should sum to 100
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kpi_scorecard_config ENABLE ROW LEVEL SECURITY;
-- Config is not sensitive (targets/weights); every authenticated user's scorecard
-- reads it. Writes go through the service client in the admin settings API, so we
-- add no write policy here.
DROP POLICY IF EXISTS "Authenticated can read kpi config" ON kpi_scorecard_config;
CREATE POLICY "Authenticated can read kpi config"
  ON kpi_scorecard_config FOR SELECT TO authenticated USING (true);

-- Seed the seven scorecard KPIs. Weightages sum to 100 (15+15+10+15+15+20+10).
-- Targets are sensible starting points an admin can tune in Settings.
INSERT INTO kpi_scorecard_config
  (kpi_key, stage, label, sort_order, source, unit, target, target_basis, weightage) VALUES
  ('leads_generated',     'TOFU',     'Leads generated (per day)',       1, 'auto',   'count',   15, 'per_day',    15),
  ('calls_made',          'TOFU',     'Calls made',                      2, 'auto',   'count',   50, 'per_day',    15),
  ('talk_time_hrs',       'TOFU',     'Total talk time (hrs)',           3, 'auto',   'hours',    2, 'per_day',    10),
  ('demos_given',         'MOFU',     'Demos given',                     4, 'auto',   'count',    1, 'per_day',    15),
  ('proposals_sent',      'MOFU',     'Proposals sent',                  5, 'manual', 'count',    1, 'per_day',    15),
  ('deals_closed',        'BOFU',     'Deals closed (sales)',            6, 'auto',   'count',    5, 'per_period', 20),
  ('training_completion', 'Learning', 'Training / learning completion',  7, 'manual', 'percent', 100, 'per_period', 10)
ON CONFLICT (kpi_key) DO NOTHING;

-- Keep the KPI names/stages verbatim from the Novelio scorecard spreadsheet even
-- if the seed above was applied before with older wording. Targets/weightages are
-- intentionally left alone so admin edits survive.
UPDATE kpi_scorecard_config AS c SET label = v.label, stage = v.stage
FROM (VALUES
  ('leads_generated',     'Leads generated (per day)',       'TOFU'),
  ('calls_made',          'Calls made',                      'TOFU'),
  ('talk_time_hrs',       'Total talk time (hrs)',           'TOFU'),
  ('demos_given',         'Demos given',                     'MOFU'),
  ('proposals_sent',      'Proposals sent',                  'MOFU'),
  ('deals_closed',        'Deals closed (sales)',            'BOFU'),
  ('training_completion', 'Training / learning completion',  'Learning')
) AS v(kpi_key, label, stage)
WHERE c.kpi_key = v.kpi_key;

-- ── Manual entries: proposals sent (count) & training completion (%) ─────────
CREATE TABLE IF NOT EXISTS kpi_manual_entries (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kpi_key    TEXT NOT NULL REFERENCES kpi_scorecard_config(kpi_key) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  value      NUMERIC NOT NULL DEFAULT 0,   -- count for proposals_sent; percent (0–100) for training_completion
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kpi_key, entry_date)     -- one figure per agent/KPI/day; upsert overwrites
);
CREATE INDEX IF NOT EXISTS kpi_manual_entries_lookup_idx
  ON kpi_manual_entries (kpi_key, user_id, entry_date);

ALTER TABLE kpi_manual_entries ENABLE ROW LEVEL SECURITY;
-- Readable by any authenticated user (same posture as voice_calls/appointments,
-- which the other report RPCs read). Writes go through the service client in the
-- manual-entry API, which gates on admin-or-self.
DROP POLICY IF EXISTS "Authenticated can read manual kpi entries" ON kpi_manual_entries;
CREATE POLICY "Authenticated can read manual kpi entries"
  ON kpi_manual_entries FOR SELECT TO authenticated USING (true);

-- ── Raw per-agent achieved numbers (one call, aggregated in SQL) ─────────────
-- SECURITY INVOKER keeps RLS intact; the API restricts user_ids to the caller's
-- own id for non-admins, so agents only ever see their own achieved numbers.
-- Date semantics mirror report_user_kpis (055): leads by activity_logs.created_at,
-- demos by appointments.created_at, deals by deals.updated_at (payment 'Paid').
CREATE OR REPLACE FUNCTION report_kpi_scorecard(user_ids uuid[], from_ts timestamptz, to_ts timestamptz)
RETURNS TABLE (
  user_id         uuid,
  leads_generated bigint,
  calls_made      bigint,
  talk_hrs        numeric,
  demos_given     bigint,
  deals_closed    bigint,
  proposals_sent  numeric,
  training_pct    numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH u AS (SELECT unnest(user_ids) AS id),
  leads_gen AS (
    SELECT al.user_id AS id, count(*)::bigint c
    FROM activity_logs al
    WHERE al.user_id = ANY(user_ids) AND al.action = 'Lead Created'
      AND (from_ts IS NULL OR al.created_at >= from_ts)
      AND (to_ts   IS NULL OR al.created_at <  to_ts)
    GROUP BY al.user_id
  ),
  calls AS (
    SELECT vc.agent_user_id AS id,
           count(*)::bigint c,
           COALESCE(SUM(vc.duration_sec), 0)::numeric secs
    FROM voice_calls vc
    WHERE vc.provider = 'twilio' AND vc.agent_user_id = ANY(user_ids)
      AND (from_ts IS NULL OR vc.created_at >= from_ts)
      AND (to_ts   IS NULL OR vc.created_at <  to_ts)
    GROUP BY vc.agent_user_id
  ),
  demos AS (
    SELECT a.created_by AS id, count(*)::bigint c
    FROM appointments a
    WHERE a.created_by = ANY(user_ids) AND a.appointment_datetime IS NOT NULL
      AND (from_ts IS NULL OR a.created_at >= from_ts)
      AND (to_ts   IS NULL OR a.created_at <  to_ts)
    GROUP BY a.created_by
  ),
  dealcnt AS (
    SELECT l.assigned_agent_id AS id, count(*)::bigint c
    FROM deals d
    JOIN leads l ON l.id = d.lead_id
    WHERE l.assigned_agent_id = ANY(user_ids) AND d.payment_status = 'Paid'
      AND (from_ts IS NULL OR d.updated_at >= from_ts)
      AND (to_ts   IS NULL OR d.updated_at <  to_ts)
    GROUP BY l.assigned_agent_id
  ),
  props AS (
    SELECT m.user_id AS id, COALESCE(SUM(m.value), 0)::numeric v
    FROM kpi_manual_entries m
    WHERE m.user_id = ANY(user_ids) AND m.kpi_key = 'proposals_sent'
      AND (from_ts IS NULL OR m.entry_date >= from_ts::date)
      AND (to_ts   IS NULL OR m.entry_date <  to_ts::date)
    GROUP BY m.user_id
  ),
  -- Training completion is a %, so we take the latest figure logged in the range
  -- rather than summing.
  train AS (
    SELECT DISTINCT ON (m.user_id) m.user_id AS id, m.value v
    FROM kpi_manual_entries m
    WHERE m.user_id = ANY(user_ids) AND m.kpi_key = 'training_completion'
      AND (from_ts IS NULL OR m.entry_date >= from_ts::date)
      AND (to_ts   IS NULL OR m.entry_date <  to_ts::date)
    ORDER BY m.user_id, m.entry_date DESC
  )
  SELECT
    u.id,
    COALESCE(leads_gen.c, 0),
    COALESCE(calls.c, 0),
    ROUND(COALESCE(calls.secs, 0) / 3600.0, 2),
    COALESCE(demos.c, 0),
    COALESCE(dealcnt.c, 0),
    COALESCE(props.v, 0),
    COALESCE(train.v, 0)
  FROM u
  LEFT JOIN leads_gen ON leads_gen.id = u.id
  LEFT JOIN calls     ON calls.id     = u.id
  LEFT JOIN demos     ON demos.id     = u.id
  LEFT JOIN dealcnt   ON dealcnt.id   = u.id
  LEFT JOIN props     ON props.id     = u.id
  LEFT JOIN train     ON train.id     = u.id
$$;

GRANT EXECUTE ON FUNCTION report_kpi_scorecard(uuid[], timestamptz, timestamptz) TO authenticated;

COMMENT ON TABLE kpi_scorecard_config IS 'Admin-editable Target + Weightage per sales KPI; drives the weighted Scorecard in Reports.';
COMMENT ON TABLE kpi_manual_entries   IS 'Manually-logged KPI figures (proposals sent, training completion) with no system event behind them.';
