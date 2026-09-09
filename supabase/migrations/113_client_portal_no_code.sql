-- 113_client_portal_no_code.sql
--
-- The front door stops asking for a code. A client types their phone number or
-- email at nda123.pages.dev and goes straight to their documents.
--
-- What this trades away, recorded here because it is not obvious from the code:
-- the shared URL now has NO second factor. A business email or phone number is
-- public information — it is on the client's own website and Google listing —
-- so anyone who has one can open that client's proposal pricing, payment
-- schedule and signed agreement. This is a deliberate product decision taken
-- with that consequence understood; it is not an oversight to be "fixed" by a
-- later migration without asking first.
--
-- The per-lead links from 110 are unaffected and still carry their own
-- unguessable token plus the last-4 gate. Only the common front door is open.
--
-- share_access_codes goes: it stored a hash of a code nothing issues any more,
-- and an empty table with an obsolete purpose is worse than no table. It never
-- held production data. share_handoffs STAYS — the cookie still has to be set
-- first-party on the CRM's domain, so the one-time key that carries a visitor
-- across from pages.dev is still exactly as necessary as it was.
--
-- share_lookups replaces it as the audit trail: who asked for what, from where,
-- and whether we had them on file. It is also the rate-limit source, which is
-- now the ONLY brake on bulk scraping and so matters more than it did.

DROP TABLE IF EXISTS share_access_codes;

CREATE TABLE IF NOT EXISTS share_lookups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Normalised: last 10 digits of a phone, or a lowercased email.
  identifier  TEXT NOT NULL,
  -- 'phone' | 'email' — which kind was typed.
  kind        TEXT,
  -- NULL when the identifier matched nobody. Kept either way: a burst of misses
  -- from one address is what scraping looks like.
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,

  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The per-IP cap counts recent rows; the lead index answers "who has been
-- opening this client's documents, and from where".
CREATE INDEX IF NOT EXISTS share_lookups_ip_idx      ON share_lookups(ip, created_at DESC);
CREATE INDEX IF NOT EXISTS share_lookups_lead_id_idx ON share_lookups(lead_id, created_at DESC);

ALTER TABLE share_lookups ENABLE ROW LEVEL SECURITY;

-- Staff read it (it is the answer to "did the client actually look?"); the
-- public route writes with the service-role key. Wrapped in a scalar subquery
-- so it is evaluated once per statement, not once per row (079, 105).
CREATE POLICY "Staff view share lookups" ON share_lookups
  FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMENT ON TABLE  share_lookups            IS 'One row per attempt at the common client front door. Audit trail and rate-limit source. Service-role write, staff SELECT.';
COMMENT ON COLUMN share_lookups.identifier IS 'What was typed, normalised: last 10 digits of a phone, or a lowercased email.';
COMMENT ON COLUMN share_lookups.lead_id    IS 'NULL when nothing matched — misses are kept because a burst of them is what scraping looks like.';
