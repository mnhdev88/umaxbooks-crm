-- Migration: Add constraints and cleanup for duplicate leads

-- Create a table to track which leads were marked as duplicates during cleanup
CREATE TABLE IF NOT EXISTS duplicate_lead_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  duplicate_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  duplicate_reason TEXT NOT NULL, -- 'phone', 'email', 'company_name'
  status TEXT DEFAULT 'flagged' CHECK (status IN ('flagged', 'merged', 'manual_review')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  merged_at TIMESTAMPTZ,
  merged_by UUID REFERENCES profiles(id),
  UNIQUE(primary_lead_id, duplicate_lead_id)
);

ALTER TABLE duplicate_lead_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view duplicate records"
  ON duplicate_lead_records FOR SELECT
  USING (get_my_role() = 'admin');

CREATE POLICY "Admins can manage duplicate records"
  ON duplicate_lead_records FOR ALL
  USING (get_my_role() = 'admin');

-- Add indexes for faster duplicate detection queries
CREATE INDEX IF NOT EXISTS idx_leads_phone_lower ON leads(LOWER(phone)) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON leads(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company_lower ON leads(LOWER(company_name));

-- Note: Unique constraints on phone/email are commented out because existing duplicates exist
-- After you resolve duplicates using the admin dashboard, you can uncomment and run these:
--
-- Phone: prevent duplicate phone numbers (ignoring nulls and empty strings)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_unique
--   ON leads(LOWER(phone))
--   WHERE phone IS NOT NULL AND phone != '';
--
-- Email: prevent duplicate emails (ignoring nulls and empty strings)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_unique
--   ON leads(LOWER(email))
--   WHERE email IS NOT NULL AND email != '';

-- Add a column to track if a lead is marked as duplicate/merged
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- Create index for merged leads lookup
CREATE INDEX IF NOT EXISTS idx_leads_merged_into ON leads(merged_into_id) WHERE merged_into_id IS NOT NULL;
