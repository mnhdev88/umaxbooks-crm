-- Auto cold-outreach email after an AI voice call.
--
-- When an AI (Bland) voice call ends by any means, the webhook sends the lead the
-- "Email 1 - Cold Outreach" template (if the lead has an email and hasn't been sent
-- it before). This column is the once-per-lead guard so webhook retries and repeat
-- calls don't email the same lead twice.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS cold_outreach_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.cold_outreach_sent_at
  IS 'When the automated post-call cold-outreach email was sent. NULL = not yet sent.';
