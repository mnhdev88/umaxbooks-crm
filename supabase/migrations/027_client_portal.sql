-- Add 'client' to profiles role constraint
ALTER TABLE profiles
  DROP CONSTRAINT profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'agent', 'sales_agent', 'developer', 'client'));

-- Add lead_id to profiles so each client links to their lead
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

-- Update handle_new_user trigger to support client role + lead_id from metadata
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role, lead_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent'),
    (NEW.raw_user_meta_data->>'lead_id')::uuid
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- RLS: clients can read their own lead only
CREATE POLICY "Clients can view their own lead"
  ON leads FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = leads.id
    )
  );

-- RLS: clients can read their own live site
CREATE POLICY "Clients can view their own live site"
  ON live_sites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = live_sites.lead_id
    )
  );

-- RLS: clients can read their own revisions
CREATE POLICY "Clients can view their own revisions"
  ON revisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = revisions.lead_id
    )
  );

-- RLS: clients can read their own before/after data
CREATE POLICY "Clients can view their own before after comparisons"
  ON before_after_comparisons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = before_after_comparisons.lead_id
    )
  );

CREATE POLICY "Clients can view their own before after metrics"
  ON before_after_metrics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = before_after_metrics.lead_id
    )
  );

-- RLS: clients can read their own signed contract
CREATE POLICY "Clients can view their own contract"
  ON contracts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = contracts.lead_id
    )
  );

-- RLS: clients can read their own deal
CREATE POLICY "Clients can view their own deal"
  ON deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = deals.lead_id
    )
  );

-- Support requests table for post-launch client tickets
CREATE TABLE IF NOT EXISTS support_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  client_id      UUID REFERENCES profiles(id) NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  type           TEXT DEFAULT 'revision'
                 CHECK (type IN ('revision', 'bug', 'content', 'other')),
  status         TEXT DEFAULT 'open'
                 CHECK (status IN ('open', 'in_progress', 'resolved')),
  developer_note TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can insert their own support requests"
  ON support_requests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = support_requests.lead_id
    )
  );

CREATE POLICY "Clients can view their own support requests"
  ON support_requests FOR SELECT
  USING (client_id = auth.uid());

CREATE POLICY "Staff can view all support requests"
  ON support_requests FOR SELECT
  USING (get_my_role() IN ('admin', 'developer', 'agent', 'sales_agent'));

CREATE POLICY "Developers and admins can update support requests"
  ON support_requests FOR UPDATE
  USING (get_my_role() IN ('admin', 'developer'));

CREATE TRIGGER support_requests_updated_at
  BEFORE UPDATE ON support_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_support_requests_lead   ON support_requests(lead_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_client ON support_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
