-- Allow developers to see Audit Ready leads in addition to existing statuses.

DROP POLICY IF EXISTS "Developers can view relevant leads" ON leads;

CREATE POLICY "Developers can view relevant leads"
  ON leads FOR SELECT USING (
    get_my_role() = 'developer'
    AND status IN ('Contacted', 'Audit Ready', 'Demo Scheduled', 'Demo Done', 'Revision', 'Live', 'Completed')
  );
