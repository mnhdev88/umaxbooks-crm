-- One exclusive outcome per dialer call — and stop counting voicemail as a conversation.
--
-- THE BUG: "connected" was Twilio's status = 'completed', which only means the line was
-- picked up by *something*. A voicemail box picks up the line, so every call that rolled
-- to voicemail counted as connected — and because the report tested status and answered_by
-- in two independent branches, an agent-marked voicemail was counted TWICE (once as
-- connected, once as voicemail). Over the 60 days before this migration that was 1,824 of
-- 5,419 "connected" calls: a third of the connect number was voicemail.
--
-- THE FIX: every call resolves to exactly one outcome — connected | voicemail | no_answer
-- | unknown — via voice_call_outcome() below. "Connected" now means a human was reached:
-- the line answered AND the agent filed a wrap-up saying so.
--
-- WHY NOT A DURATION FLOOR: talk time does not separate the two. Over the same 60 days,
-- agent-marked voicemails ran a median 31s against 42s for real conversations, and 418
-- genuine conversations came in under 15s. Any threshold discards more real calls than
-- voicemails it catches, so classification rests on the agent's wrap-up, not on seconds.
--
-- WHY NOT TWILIO AMD: agents already disposition ~86% of calls, which is better ground
-- truth than machine detection gives on short voicemail greetings, and it bills per call.
-- Closing the un-dispositioned gap (see disposition_at below) is the cheaper win.

-- ── When the agent filed the wrap-up ────────────────────────────────────────
-- The signal that was missing. A dialer row reaching 'completed' told us the line
-- answered but nothing about whether a person was on it; the wrap-up form is skippable
-- (DialerProvider.skipWrapup), so a skipped call was indistinguishable from a real
-- conversation. Stamped by /api/voice/twilio/disposition on every save — including a
-- skip, which records answered_by = 'unknown' rather than nothing at all.
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ;

COMMENT ON COLUMN voice_calls.disposition_at IS
  'When the agent filed the post-call wrap-up. NULL = never dispositioned, which keeps an answered call out of the connected bucket (outcome ''unknown'').';

-- Backfill from the evidence historical rows carry. There is no updated_at on this
-- table, so created_at stands in — only the NULL/NOT NULL distinction is ever read.
-- A row counts as dispositioned if the agent left any mark the webhook could not have
-- written on its own: answered_by is 'human' for EVERY completed call (the status
-- webhook stamped it unconditionally), so it is evidence only when it says otherwise.
UPDATE voice_calls
SET disposition_at = created_at
WHERE provider = 'twilio'
  AND disposition_at IS NULL
  AND (
    answered_by IN ('voicemail', 'hangup')
    OR interested IS NOT NULL
    OR notes IS NOT NULL
    OR do_not_call
    OR appointment_booked
    OR callback_requested
  );

-- ── The shared classifier ───────────────────────────────────────────────────
-- Mirrored in TypeScript by classifyCall() in lib/dialer-report.ts, which is what the
-- Reports page, the CSV and the nightly email all run on. Change one, change the other.
--
-- Order matters: the agent's own marking outranks Twilio's status, because Twilio reports
-- a call the lead answered and instantly dropped as 'completed' just the same.
CREATE OR REPLACE FUNCTION voice_call_outcome(
  p_status         TEXT,
  p_answered_by    TEXT,
  p_disposition_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE SQL IMMUTABLE AS $$
  SELECT CASE
    -- Agent-marked, and therefore authoritative.
    WHEN p_answered_by = 'voicemail' THEN 'voicemail'
    WHEN p_answered_by = 'hangup'    THEN 'no_answer'
    -- Twilio never bridged the call at all.
    WHEN p_status IN ('busy', 'no-answer', 'failed', 'canceled') THEN 'no_answer'
    -- The line answered. Only a filed wrap-up makes that a conversation.
    WHEN p_status = 'completed' AND p_disposition_at IS NOT NULL THEN 'connected'
    -- Answered but never dispositioned, or a status we do not recognise. Deliberately
    -- NOT folded into no_answer: it is a reporting gap, and burying it would hide the
    -- skipped wrap-ups instead of surfacing them.
    ELSE 'unknown'
  END
$$;

COMMENT ON FUNCTION voice_call_outcome(TEXT, TEXT, TIMESTAMPTZ) IS
  'Exactly one of connected | voicemail | no_answer | unknown per call. Mirrored by classifyCall() in lib/dialer-report.ts.';

-- Readable by anyone who can read the calls themselves; it is pure logic over columns
-- they already see.
GRANT EXECUTE ON FUNCTION voice_call_outcome(TEXT, TEXT, TIMESTAMPTZ) TO authenticated, service_role;

-- ── Per-number health, on the corrected definition ──────────────────────────
-- `answered` now means outcome = 'connected', so the Settings → Calls health table stops
-- crediting a number for reaching voicemail.
--
-- CAREFUL: the deployed function had drifted well past what migration 091 defines — it is
-- outbound-scoped and FULL OUTER JOINs inbound calls by to_number to return a 7th column,
-- `callbacks`, which appears in no migration file. That shape is reproduced verbatim below
-- and only the two outcome filters are changed; rebuilding from 091 would silently drop
-- the callbacks column and the inbound join. DROP first because the return type changes
-- (CREATE OR REPLACE cannot alter it), which is also why the grants are re-issued.
--
-- short_calls deliberately keeps counting voicemail greetings: it is a carrier-reputation
-- signal, not a performance one, and a number whose calls keep landing in voicemail is
-- exactly what a "Spam Likely" label looks like from this side.
DROP FUNCTION IF EXISTS caller_number_health(INTEGER);

CREATE FUNCTION caller_number_health(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
  from_number   TEXT,
  calls         BIGINT,
  answered      BIGINT,   -- outcome = 'connected': a human was reached (see 109)
  conversations BIGINT,   -- >= 120s, the closest proxy for a substantive conversation
  short_calls   BIGINT,   -- line answered but < 30s: hang-ups + voicemail greetings
  avg_sec       NUMERIC,
  callbacks     BIGINT    -- inbound calls TO this number in the window
)
LANGUAGE SQL STABLE AS $$
  WITH out AS (
    SELECT
      vc.from_number AS num,
      count(*) AS calls,
      count(*) FILTER (
        WHERE voice_call_outcome(vc.status, vc.answered_by, vc.disposition_at) = 'connected'
      ) AS answered,
      count(*) FILTER (WHERE vc.duration_sec >= 120) AS conversations,
      count(*) FILTER (WHERE vc.status = 'completed' AND vc.duration_sec < 30) AS short_calls,
      round(avg(vc.duration_sec) FILTER (
        WHERE voice_call_outcome(vc.status, vc.answered_by, vc.disposition_at) = 'connected'
      ), 0) AS avg_sec
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
