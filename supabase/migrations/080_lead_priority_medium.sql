-- Add 'Medium' to the lead priority scale (sits between Normal and High).
-- The original CHECK was declared inline on the column, so Postgres named it
-- leads_priority_check.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_priority_check;
ALTER TABLE leads ADD CONSTRAINT leads_priority_check
  CHECK (priority IN ('Normal', 'Medium', 'High', 'Urgent', 'Low'));
