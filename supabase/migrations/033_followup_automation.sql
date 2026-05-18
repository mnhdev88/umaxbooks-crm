-- Add follow-up automation tracking column to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_followup_sent_at TIMESTAMPTZ;

-- Index for efficient cron query (filter by date)
CREATE INDEX IF NOT EXISTS idx_leads_last_followup_sent_at ON leads(last_followup_sent_at);
