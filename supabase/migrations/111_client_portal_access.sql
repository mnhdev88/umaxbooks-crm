-- 111_client_portal_access.sql
--
-- The common front door: one URL every client can be given (data123.pages.dev),
-- where they type their phone number, receive a short code, and land on their
-- own /share/<token> page from migration 110.
--
-- Why a code at all. A per-lead share link is safe because the uuid in it is
-- unguessable. A SHARED url throws that away: without a second step, anyone who
-- typed a phone number could read that client's pricing and signed contract,
-- and 4,000+ leads is a small space to walk. The code proves possession of the
-- phone (or of the mailbox we hold for it), which is the thing a phone number
-- alone can't.
--
-- Two tables, both service-role only:
--
--   share_access_codes — one row per code we issue. The code itself is never
--     stored, only a salted hash, so a leak of this table cannot open anyone's
--     documents. Rows are kept after use as the audit trail of who asked.
--
--   share_handoffs — a 60-second, single-use key that carries a verified
--     visitor from the Cloudflare Pages front door to crm.noveliotech.com.
--     Needed because the access cookie is set on the CRM's domain, and a page
--     on pages.dev cannot set it: that would be a third-party cookie, which
--     Safari blocks outright. The key is exchanged for the cookie by a normal
--     top-level navigation, so the cookie lands first-party where it belongs.
--
-- Neither table gets an RLS policy. RLS is enabled and nothing is granted, so
-- only the service-role key reaches them — staff have no reason to read a code
-- hash, and the public routes already run as service role.

CREATE TABLE IF NOT EXISTS share_access_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Last 10 digits, the same normalisation lead_id_for_phone() uses (092), so a
  -- code issued to "(813) 555-1234" is found by "+1 813 555 1234".
  phone_digits  TEXT NOT NULL CHECK (length(phone_digits) = 10),
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,

  -- sha256(code + secret). Never the code itself.
  code_hash     TEXT NOT NULL,
  -- 'email' | 'sms' — where it was actually delivered.
  channel       TEXT,
  -- Masked destination shown back to the client ("j••••n@gmail.com"), so the
  -- page can say where to look without printing an address to whoever typed
  -- the number.
  destination   TEXT,

  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  consumed_at   TIMESTAMPTZ,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The verify route reads the newest live code for a number; the request route
-- counts recent rows per number and per IP to rate-limit.
CREATE INDEX IF NOT EXISTS share_access_codes_phone_idx ON share_access_codes(phone_digits, created_at DESC);
CREATE INDEX IF NOT EXISTS share_access_codes_ip_idx    ON share_access_codes(ip, created_at DESC);

CREATE TABLE IF NOT EXISTS share_handoffs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  link_id     UUID NOT NULL REFERENCES lead_share_links(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS share_handoffs_key_idx ON share_handoffs(key);

ALTER TABLE share_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_handoffs     ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  share_access_codes             IS 'One row per access code issued at the common client front door. Hash only, never the code. Service-role only (RLS on, no policies).';
COMMENT ON COLUMN share_access_codes.phone_digits IS 'Last 10 digits, matching lead_id_for_phone() normalisation (092).';
COMMENT ON COLUMN share_access_codes.destination  IS 'Masked email/phone shown back to the client so the page can say where the code went.';
COMMENT ON TABLE  share_handoffs                  IS 'Single-use 60s key carrying a verified visitor from the Pages front door to a first-party cookie on the CRM domain.';
