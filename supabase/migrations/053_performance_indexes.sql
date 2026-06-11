-- 053_performance_indexes.sql
-- Performance: add indexes on columns used in ORDER BY / WHERE / JOIN by the
-- hot paths (leads list, dashboard pipeline, reports/KPIs, lead detail tabs,
-- round-robin assignment, expiry cron). All IF NOT EXISTS so this is safe to
-- re-run. Existing leads indexes already cover status / assigned_agent_id /
-- lower(phone|email|company) — these fill the remaining gaps.

-- Leads list orders by created_at DESC; dashboard pipeline orders by updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_updated_at ON leads(updated_at DESC);

-- Reports "leads added by agent in period" drill-down filters leads by created_by
-- (+ created_at range); the in-table source/city filters use these columns too.
CREATE INDEX IF NOT EXISTS idx_leads_created_by ON leads(created_by);
CREATE INDEX IF NOT EXISTS idx_leads_source     ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_city       ON leads(city);

-- activity_logs is filtered by (user_id, action) for the leads agent-filter and
-- the user-KPI report; the only existing index is on lead_id.
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_action ON activity_logs(user_id, action);

-- Lead-detail tabs join these tables by lead_id but none were indexed.
CREATE INDEX IF NOT EXISTS idx_lead_contact_notes_lead ON lead_contact_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_audit_notes_lead         ON audit_notes(lead_id);
CREATE INDEX IF NOT EXISTS idx_content_library_lead     ON content_library(lead_id);

-- pick_round_robin_agent() runs on every lead insert: filters is_active and
-- groups by profile_id. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_round_robin_agents_active
  ON round_robin_agents(profile_id) WHERE is_active = TRUE;

-- Expiry cron looks up sent reminders by lead_id (only a composite UNIQUE existed).
CREATE INDEX IF NOT EXISTS idx_expiry_reminders_sent_lead ON expiry_reminders_sent(lead_id);

-- Email templates / drafts listed by owner.
CREATE INDEX IF NOT EXISTS idx_email_templates_created_by ON email_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_email_drafts_saved_by      ON email_drafts(saved_by);
