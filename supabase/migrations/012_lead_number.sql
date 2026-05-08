-- Add auto-incrementing lead_number column formatted as NVL-001

-- Create dedicated sequence
CREATE SEQUENCE IF NOT EXISTS leads_lead_number_seq;

-- Add nullable column first so we can backfill
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_number INTEGER;

-- Backfill existing leads in chronological order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM leads
  WHERE lead_number IS NULL
)
UPDATE leads l SET lead_number = o.rn
FROM ordered o WHERE l.id = o.id;

-- Advance sequence past the current max so new inserts don't collide
SELECT setval('leads_lead_number_seq', COALESCE((SELECT MAX(lead_number) FROM leads), 0));

-- Wire up the default and ownership
ALTER TABLE leads ALTER COLUMN lead_number SET DEFAULT nextval('leads_lead_number_seq');
ALTER TABLE leads ALTER COLUMN lead_number SET NOT NULL;
ALTER SEQUENCE leads_lead_number_seq OWNED BY leads.lead_number;

-- Ensure uniqueness
ALTER TABLE leads ADD CONSTRAINT leads_lead_number_unique UNIQUE (lead_number);
