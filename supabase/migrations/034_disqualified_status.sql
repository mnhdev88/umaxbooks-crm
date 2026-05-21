-- Add 'Disqualified' to the leads status check constraint
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'leads'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE leads DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN (
    'New', 'Contacted', 'Audit Ready', 'Callback Booked',
    'Demo Scheduled', 'Demo Done', 'Closed Won',
    'Revision', 'Live', 'Completed', 'Lost', 'Disqualified'
  ));
