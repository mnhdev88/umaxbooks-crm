-- 110_lead_share_links.sql
--
-- A client-facing link for a lead: proposal, service agreement and SEO audit on
-- one page, opened with no login.
--
-- Until now there were only two ways a client could see anything we produced:
--   * /sign/<token> — one contract, signing only, nothing else on the page.
--   * /portal       — everything, but it needs a real Supabase account with
--                     role 'client' (see client-invite), which almost no lead
--                     has while they are still deciding whether to buy.
--
-- This is the third tier, for a lead who has not signed anything yet: a rep
-- generates a link on the lead page, texts or emails it, and the client opens
-- it after typing the last 4 digits of their own phone number.
--
-- What the token is and is not:
--   The uuid IS the secret — unguessable, revocable, and dead after expires_at.
--   The last-4 check is a second factor against a forwarded or mis-sent link,
--   not the lock itself. Viewing needs no OTP; SIGNING still happens on
--   /sign/<token>, which this page only deep-links to, so the signature path
--   and its audit trail are unchanged.
--
-- The expected digits are NOT snapshotted here. They are compared at verify
-- time against the numbers currently on the lead (phone, whatsapp_number,
-- alt_phones), so correcting a typo'd phone number fixes the link instead of
-- leaving a stale copy that no longer matches the client's actual handset.
--
-- Nothing in here is written by the browser: the public routes use the service
-- client, so RLS below only has to describe what STAFF may see.

CREATE TABLE IF NOT EXISTS lead_share_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  token        UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  -- Which tabs the client sees. A rep can send the audit alone before there is
  -- any proposal to show, so this is per-link rather than derived from what
  -- data happens to exist.
  sections     TEXT[] NOT NULL DEFAULT ARRAY['proposal','contract','audit']::text[]
               CHECK (sections <@ ARRAY['proposal','contract','audit']::text[]
                      AND array_length(sections, 1) >= 1),

  -- Derived nowhere and enforced everywhere: an expired or revoked link renders
  -- the "ask us for a fresh link" screen and serves no files.
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,

  -- Brute-force brake on the last-4 gate. 10,000 combinations is not many, so
  -- failures are counted on the row itself and lock the link for a while; a
  -- correct entry clears both. Kept here rather than in memory because the app
  -- runs under PM2 and a restart must not hand an attacker a fresh budget.
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,

  view_count     INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,

  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_share_links_lead_id_idx ON lead_share_links(lead_id, created_at DESC);

-- One row per open, so the rep can see that the client read the proposal twice
-- and never opened the agreement. Also the audit trail for a leaked link.
CREATE TABLE IF NOT EXISTS lead_share_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    UUID NOT NULL REFERENCES lead_share_links(id) ON DELETE CASCADE,
  -- 'gate' for a successful last-4 verification, otherwise the section opened.
  section    TEXT,
  ip         TEXT,
  user_agent TEXT,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_share_views_link_id_idx ON lead_share_views(link_id, viewed_at DESC);

ALTER TABLE lead_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_share_views ENABLE ROW LEVEL SECURITY;

-- Staff read; the API routes write with the service-role key. auth calls are
-- wrapped in a scalar subquery so they are evaluated once per statement rather
-- than once per row (migrations 079 and 105).
CREATE POLICY "Staff view share links" ON lead_share_links
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

CREATE POLICY "Staff view share link views" ON lead_share_views
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMENT ON TABLE  lead_share_links             IS 'No-login client links (/share/<token>) exposing proposal / agreement / SEO audit for one lead. Service-role write, staff SELECT.';
COMMENT ON COLUMN lead_share_links.sections    IS 'Subset of proposal|contract|audit the client may see on this link.';
COMMENT ON COLUMN lead_share_links.locked_until IS 'Set when failed_attempts hits the cap; the gate refuses all entries until it passes.';
COMMENT ON TABLE  lead_share_views             IS 'One row per gate pass or section open on a share link.';
