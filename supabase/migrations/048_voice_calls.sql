-- Persist structured data captured during AI voice calls.
--
-- Bland posts the end-of-call record to /api/voice/webhook. The webhook calls
-- Bland's analyze endpoint to extract what the CALLER actually said (interest,
-- appointment/callback, business qualifiers, objections, do-not-call) and stores
-- one row per call here, plus a roll-up of the latest outcome on the lead itself.

-- ── One row per AI voice call ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_calls (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id             UUID REFERENCES leads(id) ON DELETE CASCADE,
  call_id             TEXT,                       -- Bland's call_id
  -- Call metadata (straight from the Bland webhook)
  answered_by         TEXT,                       -- 'human' | 'voicemail' | 'unknown'
  completed           BOOLEAN,
  call_length_min     NUMERIC,
  recording_url       TEXT,
  transcript          TEXT,
  summary             TEXT,                       -- Bland's own AI summary
  -- Interest & outcome
  interested          TEXT,                       -- 'yes' | 'no' | 'maybe' | NULL
  objection           TEXT,
  do_not_call         BOOLEAN DEFAULT FALSE,
  -- Appointment / callback
  appointment_booked  BOOLEAN DEFAULT FALSE,
  appointment_time    TEXT,                       -- free text, e.g. 'Thursday 2pm'
  callback_requested  BOOLEAN DEFAULT FALSE,
  callback_time       TEXT,
  -- Business qualifiers
  has_website         BOOLEAN,
  current_website     TEXT,
  budget_mentioned    TEXT,
  decision_maker      BOOLEAN,
  -- Free-text notes (anything else the caller volunteered)
  notes               TEXT,
  -- Full extracted object as returned by Bland's analyze endpoint, for forward-compat
  extracted           JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS voice_calls_lead_id_idx ON voice_calls(lead_id);
-- Plain (non-partial) unique index so the webhook's upsert ON CONFLICT (call_id)
-- is idempotent across Bland retries. NULL call_ids stay distinct in Postgres,
-- so calls without an id never collide.
CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_call_id_key ON voice_calls(call_id);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
-- The webhook writes with the service-role key (bypasses RLS); staff read in the UI.
CREATE POLICY "Authenticated users can view voice calls"
  ON voice_calls FOR SELECT USING (auth.role() = 'authenticated');

-- ── Latest-call roll-up on the lead ─────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_call       BOOLEAN DEFAULT FALSE;  -- caller asked not to be called
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_outcome TEXT;                   -- e.g. 'yes' | 'no' | 'voicemail'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_call_at      TIMESTAMPTZ;            -- when the last AI call ended

COMMENT ON TABLE  voice_calls            IS 'Structured data extracted from each AI (Bland) voice call.';
COMMENT ON COLUMN leads.do_not_call      IS 'TRUE once a caller asked not to be contacted again (set from AI call extraction).';
COMMENT ON COLUMN leads.last_call_outcome IS 'Interest/answer outcome of the most recent AI voice call.';
