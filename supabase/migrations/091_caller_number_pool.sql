-- 091_caller_number_pool.sql
-- Outbound caller-ID pool, so cold-call volume spreads across several numbers
-- instead of burning one.
--
-- WHY: a single TWILIO_CALLER_ID was placing ~170 calls/day. The carrier analytics
-- engines behind the handset spam labels (TNS, First Orion, Hiya) score per-number
-- call volume, short-call ratio and answer rate — that profile got the number
-- tagged "Spam Likely", which then depressed pickup further. Spreading volume under
-- a per-number daily cap keeps each number under the threshold, and matching the
-- from-number's area code to the lead's lifts pickup on top of that.
--
-- IMPORTANT: rotation ALONE is the spammer pattern and gets detected faster than a
-- single number does. Every number added here must first be registered in Twilio
-- Trust Hub (SHAKEN/STIR Attestation A + CNAM) and submitted to
-- freecallerregistry.com. The `registered` flag below tracks that; the picker
-- prefers registered numbers and the Settings UI warns about unregistered ones.
--
-- No seed row: lib/voice/caller-numbers.ts falls back to the TWILIO_CALLER_ID env
-- var whenever the pool is empty, so the dialer keeps working untouched until an
-- admin adds numbers.

-- ── The pool ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS caller_numbers (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,             -- E.164, e.g. +19086395666
  label        TEXT,                             -- human note: 'NJ main', 'TX local'
  -- Derived, not stored by hand, so it can never drift from phone_number.
  -- NULL for non-US numbers, which simply never win the local-presence match.
  area_code    TEXT GENERATED ALWAYS AS (
                 CASE WHEN phone_number ~ '^\+1[0-9]{10}$'
                      THEN substring(phone_number FROM 3 FOR 3) END
               ) STORED,
  daily_cap    INTEGER NOT NULL DEFAULT 50,      -- max outbound calls per reporting day
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  registered   BOOLEAN NOT NULL DEFAULT FALSE,   -- Trust Hub + Free Caller Registry done
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE  caller_numbers            IS 'Pool of outbound caller IDs for the Twilio dialer. Volume is spread across these under per-number daily caps to avoid carrier spam labelling.';
COMMENT ON COLUMN caller_numbers.area_code  IS 'Derived from phone_number (US only). Used to prefer a from-number matching the lead''s area code.';
COMMENT ON COLUMN caller_numbers.daily_cap  IS 'Max calls per reporting day (see lib/reporting-day.ts). Keep at or below ~50 for cold outbound.';
COMMENT ON COLUMN caller_numbers.registered IS 'TRUE once the number has Trust Hub Attestation A + CNAM and is filed with freecallerregistry.com. Unregistered numbers get labelled regardless of volume.';

CREATE INDEX IF NOT EXISTS caller_numbers_active_idx ON caller_numbers(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS caller_numbers_area_idx   ON caller_numbers(area_code) WHERE is_active;

-- ── Which number placed each call ───────────────────────────────────────────
-- Without this we can't attribute reputation damage or enforce the cap.
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS from_number TEXT;

COMMENT ON COLUMN voice_calls.from_number IS 'Caller ID used for this call. Populated by the Twilio dialer; NULL on pre-091 rows and AI (Bland) calls.';

-- The cap query is "count calls on this number since the reporting-day start", so
-- index the pair. Partial: only dialer rows ever carry a from_number.
CREATE INDEX IF NOT EXISTS voice_calls_from_number_created_idx
  ON voice_calls(from_number, created_at DESC)
  WHERE from_number IS NOT NULL;

-- ── Per-number health ───────────────────────────────────────────────────────
-- Aggregated in SQL on purpose: PostgREST caps a select at 1000 rows, and the
-- dialer already does >1400 calls/month, so counting client-side would silently
-- under-report. These are the same signals the carrier analytics engines score —
-- a number whose short-call share climbs and conversation share falls is being
-- labelled, and should be rested before it drags the rest of the pool down.
CREATE OR REPLACE FUNCTION caller_number_health(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  from_number   TEXT,
  calls         BIGINT,
  answered      BIGINT,   -- Twilio 'completed' (NB: includes voicemail — no AMD yet)
  conversations BIGINT,   -- >= 120s, the closest proxy for a real conversation
  short_calls   BIGINT,   -- answered but < 30s: hang-ups + voicemail greetings
  avg_sec       NUMERIC
)
LANGUAGE SQL STABLE AS $$
  SELECT
    vc.from_number,
    count(*),
    count(*) FILTER (WHERE vc.status = 'completed'),
    count(*) FILTER (WHERE vc.duration_sec >= 120),
    count(*) FILTER (WHERE vc.status = 'completed' AND vc.duration_sec < 30),
    round(avg(vc.duration_sec) FILTER (WHERE vc.status = 'completed'), 0)
  FROM voice_calls vc
  WHERE vc.provider = 'twilio'
    AND vc.from_number IS NOT NULL
    AND vc.created_at > now() - make_interval(days => p_days)
  GROUP BY vc.from_number
$$;

-- Admin-gated API route only (it uses the service client). Functions are EXECUTE-able
-- by PUBLIC by default, so revoke before granting.
REVOKE EXECUTE ON FUNCTION caller_number_health(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION caller_number_health(INTEGER) TO service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Caller IDs are not secret (the lead sees them), so any authenticated user may
-- read — the dialer UI shows which number it will call from. Only admins manage.
-- get_my_role() is wrapped in a scalar subquery so Postgres evaluates it once per
-- query as an InitPlan rather than once per row (see migration 079).
ALTER TABLE caller_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read caller numbers" ON caller_numbers;
CREATE POLICY "Authenticated can read caller numbers"
  ON caller_numbers FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage caller numbers" ON caller_numbers;
CREATE POLICY "Admins can manage caller numbers"
  ON caller_numbers FOR ALL
  TO authenticated
  USING ((select get_my_role()) = 'admin')
  WITH CHECK ((select get_my_role()) = 'admin');
