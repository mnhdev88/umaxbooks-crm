-- 099_email_engagement_events.sql
-- Per-event email engagement log: who opened/clicked, from which IP, on what client.
--
-- Migration 024 gave email_tracking one row per sent email with counters
-- (opened_count, first/last_opened_at). Counters can't answer "where was the lead
-- when they opened it" — five opens from three cities collapse into "5×". This table
-- is the event log underneath those counters: one row per open or click, carrying the
-- request IP, user agent, and a resolved location.
--
-- Counters on email_tracking / email_sends are deliberately NOT replaced — the list
-- view reads them directly (one indexed lookup per token), and only the detail drawer
-- pays for the event rows. Same split as voice_calls vs. its per-leg detail.
--
-- IMPORTANT — the IP is frequently NOT the recipient's:
--   Gmail / Google Workspace proxy every remote image through Google's servers, Apple
--   Mail Privacy Protection relays (and prefetches) them, and Outlook.com does the same.
--   For those, the IP belongs to the provider's datacenter and its geolocation is
--   meaningless. is_proxy marks these so the UI can say "location hidden" instead of
--   showing a lead as being in Council Bluffs, Iowa. Clicks, by contrast, come from the
--   recipient's real browser, so click rows are the trustworthy location signal.
--
-- Geo columns are left NULL by the tracking routes on purpose: the pixel route must
-- return the GIF immediately and cannot wait on a geo-IP lookup. They are filled in
-- later (background resolve / local MaxMind lookup) — see lib/request-ip.ts.

CREATE TABLE IF NOT EXISTS email_engagement_events (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  -- Denormalised token rather than an FK to email_tracking: the click route is keyed on
  -- email_sends.tracking_token and the open route on email_tracking.token, and they are
  -- the same value. Storing the token keeps one insert path for both.
  token         UUID NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
  ip            INET,                      -- NULL when the proxy header was absent/unparseable
  user_agent    TEXT,
  -- TRUE when the request came from a mail-provider image proxy (Gmail, Apple MPP,
  -- Outlook). Location on these rows describes the proxy, not the lead.
  is_proxy      BOOLEAN NOT NULL DEFAULT FALSE,
  proxy_name    TEXT,                      -- 'gmail' | 'apple' | 'outlook' | 'yahoo' | NULL
  -- Resolved lazily; NULL means "not looked up yet", not "unknown location".
  geo_city      TEXT,
  geo_region    TEXT,
  geo_country   TEXT,                      -- ISO-3166 alpha-2
  geo_resolved_at TIMESTAMPTZ,
  clicked_url   TEXT,                      -- click rows only
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Drawer query: every event for one email, newest first.
CREATE INDEX IF NOT EXISTS email_engagement_events_token_idx
  ON email_engagement_events(token, created_at DESC);
-- Lead-level engagement timeline (EmailHistory on the lead page).
CREATE INDEX IF NOT EXISTS email_engagement_events_lead_idx
  ON email_engagement_events(lead_id, created_at DESC);
-- Backlog scan for the geo resolver: unresolved, real-recipient rows only.
CREATE INDEX IF NOT EXISTS email_engagement_events_geo_pending_idx
  ON email_engagement_events(created_at)
  WHERE geo_resolved_at IS NULL AND ip IS NOT NULL AND is_proxy = FALSE;

ALTER TABLE email_engagement_events ENABLE ROW LEVEL SECURITY;

-- The tracking routes write with the service-role key (bypasses RLS); staff read the
-- timeline in the UI. auth.role() is wrapped in a scalar subquery so it is evaluated
-- once per query rather than once per row (see migration 079).
CREATE POLICY "Authenticated users can view email engagement events"
  ON email_engagement_events FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

-- Denormalised summary of the most recent trustworthy (non-proxy) open, so the Email
-- Status list can show a location column without joining the event log per row.
ALTER TABLE email_tracking
  ADD COLUMN IF NOT EXISTS last_open_ip       INET,
  ADD COLUMN IF NOT EXISTS last_open_location TEXT,
  ADD COLUMN IF NOT EXISTS last_open_is_proxy BOOLEAN;

COMMENT ON TABLE  email_engagement_events            IS 'One row per email open or click, with request IP and client. Service-role write (tracking routes), staff SELECT.';
COMMENT ON COLUMN email_engagement_events.ip         IS 'Request IP from X-Forwarded-For. For opens this is often a mail-provider proxy, not the recipient — check is_proxy.';
COMMENT ON COLUMN email_engagement_events.is_proxy   IS 'TRUE when the open came via Gmail/Apple MPP/Outlook image proxy; geolocation then describes the proxy, not the lead.';
COMMENT ON COLUMN email_engagement_events.geo_resolved_at IS 'When geo_* was populated. NULL = lookup not yet run (routes never block on geo).';
COMMENT ON COLUMN email_tracking.last_open_is_proxy  IS 'Whether the most recent open was proxied; NULL when never opened.';
