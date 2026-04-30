-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'developer')) DEFAULT 'agent',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SECURITY DEFINER function bypasses RLS so profile policies don't recurse
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user can read profiles
CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT USING (auth.role() = 'authenticated');

-- INSERT: allow unconditionally — the trigger runs without auth context,
-- and data integrity is enforced by FK + CHECK constraints
CREATE POLICY "Allow profile creation"
  ON profiles FOR INSERT WITH CHECK (true);

-- UPDATE: own profile, OR admin
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE USING (get_my_role() = 'admin');

-- DELETE: admin only
CREATE POLICY "Admins can delete profiles"
  ON profiles FOR DELETE USING (get_my_role() = 'admin');

-- Function to auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'agent')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Leads table
CREATE TABLE leads (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  company_name TEXT NOT NULL,
  address TEXT,
  zip_code TEXT,
  city TEXT,
  country TEXT DEFAULT 'US',
  website_url TEXT,
  gmb_review_rating DECIMAL(3,1),
  gmb_category TEXT,
  number_of_reviews INTEGER,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Contacted','Audit Ready','Demo Scheduled','Demo Done','Closed Won','Revision','Live','Completed','Lost')),
  assigned_agent_id UUID REFERENCES profiles(id),
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents and admins can view all leads"
  ON leads FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

CREATE POLICY "Developers can view demo-stage leads"
  ON leads FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'developer')
    AND status IN ('Demo Scheduled', 'Demo Done', 'Revision', 'Live', 'Completed')
  );

CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'agent' AND id = leads.assigned_agent_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete leads"
  ON leads FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Audits table
CREATE TABLE audits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  sitemap_pdf_url TEXT,
  audit_short_pdf_url TEXT,
  audit_long_pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view audits"
  ON audits FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Agents and admins can manage audits"
  ON audits FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

-- Appointments table
CREATE TABLE appointments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  call_date DATE,
  outcome_notes TEXT,
  appointment_datetime TIMESTAMPTZ,
  zoom_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view appointments"
  ON appointments FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Agents and admins can manage appointments"
  ON appointments FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

-- Demos table
CREATE TABLE demos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  developer_id UUID REFERENCES profiles(id),
  temp_url TEXT,
  demo_version TEXT,
  upload_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE demos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view demos"
  ON demos FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Developers and admins can manage demos"
  ON demos FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'developer'))
  );

-- Deals table
CREATE TABLE deals (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  services TEXT[] DEFAULT '{}',
  start_date DATE,
  end_date DATE,
  duration_days INTEGER GENERATED ALWAYS AS (
    CASE WHEN start_date IS NOT NULL AND end_date IS NOT NULL
    THEN (end_date - start_date) ELSE NULL END
  ) STORED,
  token_amount DECIMAL(10,2),
  final_payment_amount DECIMAL(10,2),
  payment_status TEXT DEFAULT 'Pending' CHECK (payment_status IN ('Pending','Partial','Paid','Overdue')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view deals"
  ON deals FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Agents and admins can manage deals"
  ON deals FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

-- Revisions table
CREATE TABLE revisions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  client_photos_urls TEXT[] DEFAULT '{}',
  phone TEXT,
  email TEXT,
  owner_photo_url TEXT,
  custom_notes TEXT,
  version_label TEXT NOT NULL CHECK (version_label IN ('v1','v2','v3')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view revisions"
  ON revisions FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Agents and admins can manage revisions"
  ON revisions FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'agent'))
  );

CREATE POLICY "Developers can view revisions"
  ON revisions FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'developer')
  );

-- Live sites table
CREATE TABLE live_sites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL UNIQUE,
  final_url TEXT,
  go_live_date DATE,
  hosting_provider TEXT,
  domain_status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view live sites"
  ON live_sites FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Developers and admins can manage live sites"
  ON live_sites FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'developer'))
  );

-- Activity logs table
CREATE TABLE activity_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view activity logs"
  ON activity_logs FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert activity logs"
  ON activity_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Notifications table
CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER live_sites_updated_at BEFORE UPDATE ON live_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes for performance
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_agent ON leads(assigned_agent_id);
CREATE INDEX idx_activity_logs_lead ON activity_logs(lead_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);
CREATE INDEX idx_audits_lead ON audits(lead_id);
CREATE INDEX idx_appointments_lead ON appointments(lead_id);
CREATE INDEX idx_demos_lead ON demos(lead_id);
CREATE INDEX idx_deals_lead ON deals(lead_id);
CREATE INDEX idx_revisions_lead ON revisions(lead_id);
