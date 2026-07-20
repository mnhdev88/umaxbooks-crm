-- 092_inbound_calls.sql
-- Inbound calling: leads can now call back and reach the agent who called them.
--
-- WHY NOW: before the caller-number pool (091) there was one outbound number and no
-- inbound handling at all — a lead who hit redial reached nothing. With the pool,
-- callbacks land on whichever of several numbers happened to dial them, so every
-- pool number needs routing. Callbacks are the warmest traffic the team gets, so
-- dropping them is expensive.
--
-- Routing, implemented in app/api/voice/twilio/incoming/route.ts:
--   1. the agent who last called this number (they have the context), then
--   2. every other sales agent/manager simultaneously (hunt group), then
--   3. voicemail + a notification on the owning agent.

-- ── Distinguish the two legs of a call ──────────────────────────────────────
-- 091 added from_number meaning "the caller ID we dialed out on". For an inbound
-- call the caller ID belongs to the LEAD, so we record both ends explicitly:
--   outbound: from_number = our pool number, to_number = the lead
--   inbound:  from_number = the lead,        to_number = our pool number
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS to_number TEXT;

COMMENT ON COLUMN voice_calls.from_number IS 'Originating number. Outbound: the pool caller ID we dialed from. Inbound: the lead''s number. NULL on pre-091 rows and AI (Bland) calls.';
COMMENT ON COLUMN voice_calls.to_number   IS 'Destination number. Outbound: the lead. Inbound: the pool number they called back on.';

-- How an inbound call was resolved, so missed-callback follow-up is queryable.
-- NULL on every outbound row.
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS inbound_outcome TEXT;

COMMENT ON COLUMN voice_calls.inbound_outcome IS 'Inbound only: ''answered-owner'' | ''answered-hunt'' | ''voicemail'' | ''abandoned'' (hung up before anyone picked up).';

CREATE INDEX IF NOT EXISTS voice_calls_inbound_idx
  ON voice_calls(direction, created_at DESC)
  WHERE direction = 'inbound';

-- ── Scope the pool accounting to outbound ───────────────────────────────────
-- Inbound rows carry a from_number too (the lead's), and without this filter they
-- would be counted against a caller number's daily cap and pollute its health
-- stats. Every pre-092 twilio row is already direction='outbound', so adding the
-- filter changes no existing figure.
--
-- Dropped rather than replaced: 091's version returned 6 columns and this adds a
-- 7th, which CREATE OR REPLACE cannot do (42P13).
DROP FUNCTION IF EXISTS caller_number_health(INTEGER);

CREATE FUNCTION caller_number_health(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  from_number   TEXT,
  calls         BIGINT,
  answered      BIGINT,
  conversations BIGINT,
  short_calls   BIGINT,
  avg_sec       NUMERIC,
  callbacks     BIGINT   -- inbound calls received ON this number; a healthy signal
)
LANGUAGE SQL STABLE AS $$
  WITH out AS (
    SELECT
      vc.from_number AS num,
      count(*) AS calls,
      count(*) FILTER (WHERE vc.status = 'completed') AS answered,
      count(*) FILTER (WHERE vc.duration_sec >= 120) AS conversations,
      count(*) FILTER (WHERE vc.status = 'completed' AND vc.duration_sec < 30) AS short_calls,
      round(avg(vc.duration_sec) FILTER (WHERE vc.status = 'completed'), 0) AS avg_sec
    FROM voice_calls vc
    WHERE vc.provider = 'twilio'
      AND vc.direction = 'outbound'
      AND vc.from_number IS NOT NULL
      AND vc.created_at > now() - make_interval(days => p_days)
    GROUP BY vc.from_number
  ),
  inb AS (
    SELECT vc.to_number AS num, count(*) AS callbacks
    FROM voice_calls vc
    WHERE vc.provider = 'twilio'
      AND vc.direction = 'inbound'
      AND vc.to_number IS NOT NULL
      AND vc.created_at > now() - make_interval(days => p_days)
    GROUP BY vc.to_number
  )
  SELECT
    coalesce(out.num, inb.num),
    coalesce(out.calls, 0),
    coalesce(out.answered, 0),
    coalesce(out.conversations, 0),
    coalesce(out.short_calls, 0),
    out.avg_sec,
    coalesce(inb.callbacks, 0)
  FROM out FULL OUTER JOIN inb ON out.num = inb.num
$$;

REVOKE EXECUTE ON FUNCTION caller_number_health(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION caller_number_health(INTEGER) TO service_role;

-- ── Find the lead behind an incoming number ─────────────────────────────────
-- Phone formats vary across the table ('+1908…', '(908) 639-5666', '908-639-5666'),
-- and 076 added alt_phones, so a plain equality match misses. This compares the
-- last 10 digits of every stored number — primary and alternates — against the
-- caller. SECURITY DEFINER because the inbound webhook is unauthenticated (Twilio)
-- and has no session to satisfy the leads RLS policies; it returns one id, never
-- lead data. Locked to service_role, which the webhook uses.
CREATE OR REPLACE FUNCTION lead_id_for_phone(p_phone TEXT)
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH target AS (
    SELECT right(regexp_replace(p_phone, '\D', '', 'g'), 10) AS d
  )
  SELECT l.id
  FROM leads l, target t
  WHERE length(t.d) = 10
    AND (
      right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = t.d
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(l.alt_phones) = 'array' THEN l.alt_phones ELSE '[]'::jsonb END
             ) AS alt(v)
        WHERE right(regexp_replace(alt.v, '\D', '', 'g'), 10) = t.d
      )
    )
  -- Most recently touched wins when the same number sits on more than one lead.
  ORDER BY l.updated_at DESC NULLS LAST, l.created_at DESC
  LIMIT 1
$$;

COMMENT ON FUNCTION lead_id_for_phone(TEXT) IS 'Resolve an inbound caller number to a lead id, matching the last 10 digits against leads.phone and leads.alt_phones. Used by the unauthenticated Twilio inbound webhook.';

REVOKE EXECUTE ON FUNCTION lead_id_for_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION lead_id_for_phone(TEXT) TO service_role;
