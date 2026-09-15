-- 111_seo_agent_role.sql
-- The SEO agent: a POST-SALE role that watches live client websites, works a
-- queue of SEO issues, and reports each month's work back to the client.
--
-- Everything here hangs off live_sites — one row per delivered client site —
-- so "the SEO agent's world" is exactly the set of sites we've put live.
-- Nothing in this migration touches the pre-sale audit flow sales already runs;
-- that stays on the leads/audits tables where it is.

-- ── 1. The role ────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'agent', 'sales_agent', 'sales_manager', 'developer', 'seo_agent', 'client'));

-- ── 2. SEO fields on the live site ─────────────────────────────────────────
-- target_keywords / gsc_property / gbp_url are recorded now but unused by this
-- first build: they're what a rank-tracking or Search Console integration would
-- key off later, and they cost nothing to collect from day one.
ALTER TABLE live_sites
  ADD COLUMN IF NOT EXISTS assigned_seo_agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seo_plan              TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS seo_check_frequency   TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS seo_started_at        DATE,
  ADD COLUMN IF NOT EXISTS seo_auto_report       BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS seo_report_email      TEXT,
  ADD COLUMN IF NOT EXISTS target_keywords       TEXT[],
  ADD COLUMN IF NOT EXISTS gsc_property          TEXT,
  ADD COLUMN IF NOT EXISTS gbp_url               TEXT,
  ADD COLUMN IF NOT EXISTS last_seo_check_at     TIMESTAMPTZ;

DO $mig$ BEGIN
  ALTER TABLE live_sites ADD CONSTRAINT live_sites_seo_plan_check
    CHECK (seo_plan IN ('none', 'basic', 'pro'));
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

DO $mig$ BEGIN
  ALTER TABLE live_sites ADD CONSTRAINT live_sites_seo_freq_check
    CHECK (seo_check_frequency IN ('weekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

CREATE INDEX IF NOT EXISTS idx_live_sites_seo_agent ON live_sites(assigned_seo_agent_id)
  WHERE assigned_seo_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_sites_seo_plan  ON live_sites(seo_plan)
  WHERE seo_plan <> 'none';

-- ── 3. RLS helper: is this site mine? ──────────────────────────────────────
-- SECURITY DEFINER avoids RLS recursion, same pattern as get_my_role()/manages_agent().
CREATE OR REPLACE FUNCTION my_seo_site(site UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM live_sites
    WHERE id = site AND assigned_seo_agent_id = auth.uid()
  )
$fn$;

-- ── 4. seo_checks — one row per crawl ──────────────────────────────────────
-- Stores exactly what /api/seo-audit and /api/pagespeed already return, so the
-- history is replayable and the month-over-month delta is a two-row query.
CREATE TABLE IF NOT EXISTS seo_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID REFERENCES live_sites(id) ON DELETE CASCADE NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  url           TEXT NOT NULL,
  ran_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  ran_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  onpage_score  INTEGER,          -- /api/seo-audit score (0-100)
  psi_seo       INTEGER,          -- Lighthouse SEO
  psi_perf      INTEGER,          -- Lighthouse performance
  psi_a11y      INTEGER,          -- Lighthouse accessibility
  cms           TEXT,
  onpage        JSONB,            -- full crawl payload (checks[], counts)
  psi           JSONB,            -- full PageSpeed payload (scores, metrics, opportunities)
  error         TEXT,             -- set when the crawl failed; scores stay NULL
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_checks_site ON seo_checks(site_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_checks_lead ON seo_checks(lead_id);

-- ── 5. seo_issues — the agent's work queue ─────────────────────────────────
-- Derived from a check's failed/warned items. One open row per (site, key);
-- the monitor never duplicates an open issue and closes whatever got fixed.
CREATE TABLE IF NOT EXISTS seo_issues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID REFERENCES live_sites(id) ON DELETE CASCADE NOT NULL,
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  check_key      TEXT NOT NULL,           -- e.g. 'title', 'meta_description'
  label          TEXT NOT NULL,
  severity       TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('warn', 'fail')),
  detail         TEXT,                    -- the measured value at detection time
  impact         TEXT,                    -- why it matters (client-facing copy)
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'ignored')),
  first_seen_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  fixed_at       TIMESTAMPTZ,
  fixed_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  auto_fixed     BOOLEAN DEFAULT FALSE,   -- TRUE = the monitor saw it pass again
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- At most one OPEN issue per check key per site — the monitor relies on this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_issues_open_unique
  ON seo_issues(site_id, check_key) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_seo_issues_site  ON seo_issues(site_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_issues_fixed ON seo_issues(site_id, fixed_at) WHERE fixed_at IS NOT NULL;

-- ── 6. seo_tasks — the month's planned work ────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID REFERENCES live_sites(id) ON DELETE CASCADE NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'technical'
                CHECK (category IN ('technical', 'content', 'gbp', 'backlinks', 'other')),
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  assigned_to   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_tasks_site ON seo_tasks(site_id, status);
CREATE INDEX IF NOT EXISTS idx_seo_tasks_done ON seo_tasks(site_id, completed_at) WHERE completed_at IS NOT NULL;

-- ── 7. seo_reports — the monthly client report ─────────────────────────────
-- `data` is the assembled snapshot (scores, fixed issues, completed tasks) so a
-- sent report never changes retroactively when the underlying rows move on.
CREATE TABLE IF NOT EXISTS seo_reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID REFERENCES live_sites(id) ON DELETE CASCADE NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  data          JSONB NOT NULL,
  commentary    TEXT,                     -- the agent's few sentences to the client
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  sent_at       TIMESTAMPTZ,
  sent_to       TEXT,
  sent_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  generated_by  TEXT NOT NULL DEFAULT 'auto' CHECK (generated_by IN ('auto', 'manual')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- One report per site per period — the monthly cron is safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_reports_period
  ON seo_reports(site_id, period_start);
CREATE INDEX IF NOT EXISTS idx_seo_reports_status ON seo_reports(status, period_start DESC);

-- ── 8. RLS ─────────────────────────────────────────────────────────────────
-- Shape: admin does everything; the assigned SEO agent does everything on their
-- own sites; other staff get read-only (so a rep can answer "what's happening
-- with my client's SEO?" without being able to change it).
--
-- auth.uid()/get_my_role() are wrapped in (SELECT ...) so Postgres evaluates them
-- once per query instead of once per row — see migration 105.
ALTER TABLE seo_checks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_issues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_tasks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_reports ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_checks', 'seo_issues', 'seo_tasks', 'seo_reports'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Admins manage %1$s" ON %1$s FOR ALL '
      'USING ((SELECT get_my_role()) = ''admin'') '
      'WITH CHECK ((SELECT get_my_role()) = ''admin'')', t);

    EXECUTE format('DROP POLICY IF EXISTS "SEO agents manage their %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "SEO agents manage their %1$s" ON %1$s FOR ALL '
      'USING ((SELECT get_my_role()) = ''seo_agent'' AND my_seo_site(site_id)) '
      'WITH CHECK ((SELECT get_my_role()) = ''seo_agent'' AND my_seo_site(site_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS "Staff read %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Staff read %1$s" ON %1$s FOR SELECT '
      'USING ((SELECT get_my_role()) IN (''agent'', ''sales_agent'', ''sales_manager'', ''developer''))', t);
  END LOOP;
END $rls$;

-- Clients may read their OWN sent reports (portal, and any future share page).
DROP POLICY IF EXISTS "Clients read their sent reports" ON seo_reports;
CREATE POLICY "Clients read their sent reports" ON seo_reports FOR SELECT
  USING (
    status = 'sent'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = 'client'
        AND profiles.lead_id = seo_reports.lead_id
    )
  );

-- ── 9. SEO agents need their sites and those leads ─────────────────────────
DROP POLICY IF EXISTS "SEO agents update their live sites" ON live_sites;
CREATE POLICY "SEO agents update their live sites" ON live_sites FOR UPDATE
  USING ((SELECT get_my_role()) = 'seo_agent' AND assigned_seo_agent_id = (SELECT auth.uid()))
  WITH CHECK ((SELECT get_my_role()) = 'seo_agent' AND assigned_seo_agent_id = (SELECT auth.uid()));

-- live_sites SELECT is already open to any authenticated user (001), but leads
-- is not — without this an SEO agent sees a board of sites with no client names.
DROP POLICY IF EXISTS "SEO agents view their clients" ON leads;
CREATE POLICY "SEO agents view their clients" ON leads FOR SELECT
  USING (
    (SELECT get_my_role()) = 'seo_agent'
    AND EXISTS (
      SELECT 1 FROM live_sites
      WHERE live_sites.lead_id = leads.id
        AND live_sites.assigned_seo_agent_id = (SELECT auth.uid())
    )
  );
