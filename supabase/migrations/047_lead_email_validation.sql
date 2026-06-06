-- Persist the SendGrid email-validation result on each lead so the
-- verdict (and its colour) can be shown on the lead detail page / list.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verdict      TEXT;          -- 'Valid' | 'Risky' | 'Invalid'
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_score        NUMERIC;       -- 0–1 confidence from SendGrid
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_validated_at TIMESTAMPTZ;   -- when the check last ran

COMMENT ON COLUMN leads.email_verdict IS 'Last email deliverability verdict from SendGrid validation (Valid/Risky/Invalid)';
