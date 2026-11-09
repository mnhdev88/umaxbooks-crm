-- 116: Google Workspace Gmail — send as the agent + two-way sync into the CRM
--
-- 1. New provider type 'google_workspace': CRM compose sends go out through the
--    agent's own Workspace mailbox (Gmail API, domain-wide delegation), so they land
--    in the agent's Gmail "Sent" folder and keep threading with lead replies.
--    Bulk / automated mail keeps using the default provider (Resend).
--
-- 2. email_sends learns where a row came from and which way it went:
--      direction  outbound (agent → lead) | inbound (lead → agent)
--      source     crm (sent from the CRM) | gmail (picked up by the Gmail sync)
--    plus the Gmail ids needed for de-duplication and threading. Inbound rows use
--    the new status 'received'.
--
-- 3. gmail_sync_state keeps one small row per agent mailbox: the Gmail historyId
--    the incremental sync resumes from, and backfill progress / last error.
--
-- 4. match_leads_by_emails() finds leads by primary OR alternate email in one
--    indexed call, so a sync run is a single lookup rather than a scan per message.

-- ── 1. Provider type ─────────────────────────────────────────────────────────
ALTER TABLE email_providers DROP CONSTRAINT IF EXISTS email_providers_provider_check;
ALTER TABLE email_providers ADD CONSTRAINT email_providers_provider_check
  CHECK (provider IN ('gmail', 'aws_ses', 'resend', 'sendgrid', 'custom', 'google_workspace'));

-- ── 2. email_sends columns ───────────────────────────────────────────────────
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound';
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS source    TEXT NOT NULL DEFAULT 'crm';
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS gmail_message_id  TEXT;  -- id inside mailbox_user_id's mailbox
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS gmail_thread_id   TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS rfc822_message_id TEXT;  -- global Message-ID header
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS mailbox_user_id   UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_direction_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_direction_check
  CHECK (direction IN ('outbound', 'inbound'));

ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_source_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_source_check
  CHECK (source IN ('crm', 'gmail'));

ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('sent', 'scheduled', 'failed', 'delivered', 'bounced', 'spam',
                    'deferred', 'unsubscribed', 'received'));

-- The same message can sit in several agents' mailboxes (CC, forwards) with a
-- different Gmail id in each; the Message-ID header is the same everywhere, so it
-- is the de-duplication key per lead. NULLs (legacy / non-Gmail rows) never clash.
-- Plain (non-partial) unique index so PostgREST upserts can target it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_sends_lead_rfc822
  ON email_sends (lead_id, rfc822_message_id);

-- Sync skips Gmail ids it has already stored (e.g. mail sent from the CRM).
CREATE INDEX IF NOT EXISTS idx_email_sends_gmail_message_id
  ON email_sends (gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- FK index + thread lookup when continuing a conversation from the CRM.
CREATE INDEX IF NOT EXISTS idx_email_sends_mailbox_thread
  ON email_sends (mailbox_user_id, lead_id) WHERE gmail_thread_id IS NOT NULL;

-- ── 3. Per-mailbox sync state ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gmail_sync_state (
  user_id             UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  mailbox             TEXT NOT NULL,
  history_id          TEXT,          -- Gmail historyId to resume incremental sync from
  backfill_after      TIMESTAMPTZ,   -- non-null while an initial / recovery backfill is running
  backfill_page_token TEXT,
  last_synced_at      TIMESTAMPTZ,
  last_imported       INTEGER NOT NULL DEFAULT 0,  -- rows imported on the last successful run
  total_imported      INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  last_error_at       TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gmail_sync_state ENABLE ROW LEVEL SECURITY;

-- Admins can read status in Settings; only the service role (sync job) writes.
DROP POLICY IF EXISTS "admins_read_gmail_sync_state" ON gmail_sync_state;
CREATE POLICY "admins_read_gmail_sync_state" ON gmail_sync_state
  FOR SELECT TO authenticated
  USING ((SELECT get_my_role()) = 'admin');

-- ── 4. Lead lookup by email (primary + alternates) ───────────────────────────
-- leads.alt_emails is [{"value": "a@b.com", "label": "Work"}, ...] (migration 076).
CREATE OR REPLACE FUNCTION lead_alt_email_list(p jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
           array_agg(lower(btrim(e ->> 'value'))) FILTER (WHERE COALESCE(btrim(e ->> 'value'), '') <> ''),
           '{}'::text[])
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) AS e
$$;

CREATE INDEX IF NOT EXISTS idx_leads_alt_emails_lower
  ON leads USING gin (lead_alt_email_list(alt_emails));

-- p_emails must already be lower-cased. Returns one row per (lead, matched address).
CREATE OR REPLACE FUNCTION match_leads_by_emails(p_emails text[])
RETURNS TABLE (
  lead_id           uuid,
  matched_email     text,
  assigned_agent_id uuid,
  company_name      text,
  lead_name         text,
  status            text
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT l.id, lower(l.email), l.assigned_agent_id, l.company_name, l.name, l.status
  FROM leads l
  WHERE l.email IS NOT NULL
    AND lower(l.email) = ANY (p_emails)
  UNION
  SELECT l.id, a.addr, l.assigned_agent_id, l.company_name, l.name, l.status
  FROM leads l
  CROSS JOIN LATERAL unnest(lead_alt_email_list(l.alt_emails)) AS a(addr)
  WHERE lead_alt_email_list(l.alt_emails) && p_emails
    AND a.addr = ANY (p_emails)
$$;

REVOKE ALL ON FUNCTION match_leads_by_emails(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_leads_by_emails(text[]) TO service_role;
