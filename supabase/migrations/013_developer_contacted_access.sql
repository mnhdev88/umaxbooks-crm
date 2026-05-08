-- Give developers visibility into Contacted leads and allow them to add notes.

-- Extend SELECT policy to include Contacted
DROP POLICY IF EXISTS "Developers can view demo-stage leads" ON leads;

CREATE POLICY "Developers can view relevant leads"
  ON leads FOR SELECT USING (
    get_my_role() = 'developer'
    AND status IN ('Contacted', 'Demo Scheduled', 'Demo Done', 'Revision', 'Live', 'Completed')
  );

-- Allow developers to update notes on Contacted leads only
CREATE POLICY "Developers can add notes on Contacted leads"
  ON leads FOR UPDATE
  USING (
    get_my_role() = 'developer'
    AND status = 'Contacted'
  )
  WITH CHECK (
    get_my_role() = 'developer'
    AND status = 'Contacted'
  );
