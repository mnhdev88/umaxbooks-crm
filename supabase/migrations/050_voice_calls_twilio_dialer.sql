-- Extend voice_calls to cover the human Twilio softphone dialer alongside Bland AI calls.
--
-- 048 shaped voice_calls around Bland (autonomous AI agent). The Twilio dialer is a human
-- placing live calls, so we make the table provider-aware and add the fields Twilio gives
-- us (per-second duration, dial status, which agent placed it). Both providers now share
-- one table, one timeline, and one lead roll-up.

ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS provider      TEXT NOT NULL DEFAULT 'bland';
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS direction     TEXT;                 -- 'outbound' | 'inbound'
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS status        TEXT;                 -- Twilio DialCallStatus: completed/busy/no-answer/failed/canceled
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS duration_sec  INTEGER;              -- exact call seconds (Twilio); call_length_min stays for compat
ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL; -- staff who dialed

CREATE INDEX IF NOT EXISTS voice_calls_provider_idx      ON voice_calls(provider);
CREATE INDEX IF NOT EXISTS voice_calls_agent_user_id_idx ON voice_calls(agent_user_id);

COMMENT ON COLUMN voice_calls.provider      IS 'Which voice system produced this row: ''bland'' (AI agent) or ''twilio'' (human dialer).';
COMMENT ON COLUMN voice_calls.agent_user_id IS 'The staff member who placed the call (Twilio dialer only; NULL for AI calls).';
