-- 094_sms_messages.sql
-- Two-way SMS with leads, sent from the CRM by staff.
--
-- The voice side (048 → 050 → 091 → 092) gave us a provider-aware call log, a
-- caller-number pool, and inbound routing. SMS is the text analog: an agent texts a
-- lead from the lead page and the reply comes back into the same threaded view. This
-- table is the message log — one row per text, in or out — modeled directly on
-- voice_calls (provider-aware, direction-tagged, from/to explicit, service-role-write /
-- staff-SELECT).
--
-- Flow:
--   outbound: POST /api/voice/twilio/sms/send  → Twilio messages.create → row (direction
--             'outbound'), then Twilio posts delivery updates to
--             /api/voice/twilio/sms/status which updates status by message_sid.
--   inbound:  Twilio posts the lead's reply to /api/voice/twilio/sms/incoming → row
--             (direction 'inbound'), resolved to a lead via lead_id_for_phone() (092),
--             plus a notification for the assigned agent.

CREATE TABLE IF NOT EXISTS sms_messages (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL DEFAULT 'twilio',
  direction     TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  -- Explicit both-ends, same convention as voice_calls (092):
  --   outbound: from_number = our SMS number, to_number = the lead
  --   inbound:  from_number = the lead,       to_number = our SMS number
  from_number   TEXT NOT NULL,
  to_number     TEXT NOT NULL,
  body          TEXT,
  num_media     INTEGER DEFAULT 0,        -- attachments count (MMS); body may be empty when >0
  -- Twilio lifecycle: outbound queued → sending → sent → delivered | undelivered | failed;
  -- inbound rows are stamped 'received' on arrival.
  status        TEXT,
  message_sid   TEXT,                     -- Twilio Message SID (SMxx…); unique for idempotent status upserts
  error_code    TEXT,                     -- Twilio error code on undelivered/failed (e.g. 30007 carrier filtered)
  error_message TEXT,
  agent_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- staff who sent it; NULL on inbound
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_messages_lead_id_idx   ON sms_messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS sms_messages_direction_idx ON sms_messages(direction, created_at DESC);
-- Plain unique index so the status webhook's upsert ON CONFLICT (message_sid) is
-- idempotent across Twilio retries. NULL sids stay distinct in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_message_sid_key ON sms_messages(message_sid);

ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

-- Webhooks + the send route write with the service-role key (bypasses RLS); staff read
-- the thread in the UI. auth.role() is wrapped in a scalar subquery so it is evaluated
-- once per query, not once per row (see migration 079).
CREATE POLICY "Authenticated users can view sms messages"
  ON sms_messages FOR SELECT USING ((SELECT auth.role()) = 'authenticated');

COMMENT ON TABLE  sms_messages               IS 'One row per SMS to/from a lead. Service-role write (webhooks + send route), staff SELECT.';
COMMENT ON COLUMN sms_messages.from_number   IS 'Originating number. Outbound: our SMS number. Inbound: the lead''s number.';
COMMENT ON COLUMN sms_messages.to_number     IS 'Destination number. Outbound: the lead. Inbound: our SMS number.';
COMMENT ON COLUMN sms_messages.message_sid   IS 'Twilio Message SID; the key the delivery-status webhook upserts on.';
COMMENT ON COLUMN sms_messages.agent_user_id IS 'Staff member who sent an outbound text; NULL for inbound replies.';
