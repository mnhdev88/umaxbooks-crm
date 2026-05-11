-- Add 'Callback Booked' to the leads status check constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check
  CHECK (status IN ('New','Contacted','Audit Ready','Callback Booked','Demo Scheduled','Demo Done','Closed Won','Revision','Live','Completed','Lost'));
