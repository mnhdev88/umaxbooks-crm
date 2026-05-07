-- Allow all authenticated users to read email providers (needed for Compose Email)
-- Admins retain exclusive write access

DROP POLICY IF EXISTS "admins_manage_email_providers" ON email_providers;

-- All authenticated users can SELECT (to populate From dropdown)
CREATE POLICY "authenticated_read_email_providers" ON email_providers
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only admins can INSERT
CREATE POLICY "admins_insert_email_providers" ON email_providers
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can UPDATE
CREATE POLICY "admins_update_email_providers" ON email_providers
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Only admins can DELETE
CREATE POLICY "admins_delete_email_providers" ON email_providers
  FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
