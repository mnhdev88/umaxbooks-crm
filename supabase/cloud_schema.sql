-- ══════════════════════════════════════════════════════════════
-- UMAX CRM — Complete Cloud Schema
-- Paste this entire file into Supabase SQL Editor and Run All
-- ══════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── HELPER FUNCTION ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────
-- PROFILES
-- ────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      TEXT NOT NULL,
  full_name  TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'agent'
               CHECK (role IN ('admin','agent','sales_agent','developer')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SECURITY DEFINER so RLS policies on profiles don't recurse
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles are viewable by authenticated users"
  ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Allow profile creation"
  ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE USING (get_my_role() = 'admin');
CREATE POLICY "Admins can delete profiles"
  ON profiles FOR DELETE USING (get_my_role() = 'admin');

-- Auto-create profile on signup
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

-- ────────────────────────────────────────────────────────────────
-- LEADS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE leads (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name                 TEXT NOT NULL,
  company_name         TEXT NOT NULL,
  address              TEXT,
  zip_code             TEXT,
  city                 TEXT,
  country              TEXT DEFAULT 'US',
  website_url          TEXT,
  website_status       TEXT,
  social_url           TEXT,
  whatsapp_number      TEXT,
  gmb_review_rating    DECIMAL(3,1),
  gmb_category         TEXT,
  number_of_reviews    INTEGER,
  gmb_url              TEXT,
  gmb_last_seen        TEXT,
  competitor_count     INTEGER,
  competitor_notes     TEXT,
  phone                TEXT,
  email                TEXT,
  source               TEXT,
  status               TEXT NOT NULL DEFAULT 'New'
                         CHECK (status IN ('New','Contacted','Audit Ready','Demo Scheduled',
                                           'Demo Done','Closed Won','Revision','Live','Completed','Lost')),
  priority             TEXT DEFAULT 'Normal'
                         CHECK (priority IN ('Normal','High','Urgent','Low')),
  assigned_agent_id    UUID REFERENCES profiles(id),
  notes                TEXT,
  agent_private_notes  TEXT,
  custom_field_1_label TEXT,
  custom_field_1_value TEXT,
  custom_field_2_label TEXT,
  custom_field_2_value TEXT,
  follow_up_step       INTEGER DEFAULT 0,
  follow_up_paused     BOOLEAN DEFAULT FALSE,
  slug                 TEXT UNIQUE NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Agents and admins can view all leads"
  ON leads FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
            AND role IN ('admin','agent','sales_agent'))
  );
CREATE POLICY "Developers can view demo-stage leads"
  ON leads FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'developer')
    AND status IN ('Demo Scheduled','Demo Done','Revision','Live','Completed')
  );
CREATE POLICY "Agents and admins can insert leads"
  ON leads FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
            AND role IN ('admin','agent','sales_agent'))
  );
CREATE POLICY "Agents can update their own leads"
  ON leads FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()
            AND role IN ('agent','sales_agent') AND id = leads.assigned_agent_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "Developers can update lead status"
  ON leads FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'developer')
  );
CREATE POLICY "Admins can delete leads"
  ON leads FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- AUDITS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE audits (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id               UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  sitemap_pdf_url       TEXT,
  audit_short_pdf_url   TEXT,
  audit_long_pdf_url    TEXT,
  score                 INTEGER,
  scrape_data           JSONB,
  file_names            JSONB,
  agent_notes           TEXT,
  developer_notes_short TEXT,
  developer_notes_long  TEXT,
  short_uploaded_by     UUID REFERENCES profiles(id),
  long_uploaded_by      UUID REFERENCES profiles(id),
  short_uploaded_at     TIMESTAMPTZ,
  long_uploaded_at      TIMESTAMPTZ,
  short_file_size       INTEGER,
  long_file_size        INTEGER,
  tat_days              INTEGER DEFAULT 2,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view audits"
  ON audits FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage audits"
  ON audits FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- APPOINTMENTS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE appointments (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id              UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  call_date            DATE,
  outcome_notes        TEXT,
  appointment_datetime TIMESTAMPTZ,
  zoom_link            TEXT,
  client_requirements  TEXT,
  timezone             TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  created_by           UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view appointments"
  ON appointments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage appointments"
  ON appointments FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- DEMOS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE demos (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  developer_id UUID REFERENCES profiles(id),
  temp_url     TEXT,
  demo_version TEXT,
  upload_date  DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view demos"
  ON demos FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage demos"
  ON demos FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- DEALS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE deals (
  id                   UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id              UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  services             TEXT[] DEFAULT '{}',
  start_date           DATE,
  end_date             DATE,
  duration_days        INTEGER GENERATED ALWAYS AS (
                         CASE WHEN start_date IS NOT NULL AND end_date IS NOT NULL
                         THEN (end_date - start_date) ELSE NULL END
                       ) STORED,
  token_amount         DECIMAL(10,2),
  final_payment_amount DECIMAL(10,2),
  payment_status       TEXT DEFAULT 'Pending'
                         CHECK (payment_status IN ('Pending','Partial','Paid','Overdue')),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view deals"
  ON deals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage deals"
  ON deals FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER deals_updated_at
  BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- REVISIONS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE revisions (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id             UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  client_photos_urls  TEXT[] DEFAULT '{}',
  phone               TEXT,
  email               TEXT,
  owner_photo_url     TEXT,
  custom_notes        TEXT,
  version_label       TEXT NOT NULL CHECK (version_label IN ('v1','v2','v3')),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  created_by          UUID REFERENCES profiles(id) NOT NULL
);

ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view revisions"
  ON revisions FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage revisions"
  ON revisions FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- LIVE SITES
-- ────────────────────────────────────────────────────────────────
CREATE TABLE live_sites (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id          UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL UNIQUE,
  final_url        TEXT,
  go_live_date     DATE,
  hosting_provider TEXT,
  domain_status    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE live_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view live sites"
  ON live_sites FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage live sites"
  ON live_sites FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER live_sites_updated_at
  BEFORE UPDATE ON live_sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- PROJECT APPROVALS  (demo submission → admin review)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE project_approvals (
  id                  UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  appointment_id      UUID REFERENCES appointments(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','declined')),
  client_requirements TEXT,
  demo_url            TEXT,
  revision_notes      TEXT,
  developer_id        UUID REFERENCES profiles(id),
  approved_by         UUID REFERENCES profiles(id),
  approved_at         TIMESTAMPTZ,
  due_date            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE project_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view approvals"
  ON project_approvals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage approvals"
  ON project_approvals FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- BEFORE / AFTER COMPARISONS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE before_after_comparisons (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id               UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  before_screenshot_url TEXT,
  after_screenshot_url  TEXT,
  developer_summary     TEXT,
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE before_after_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view before/after"
  ON before_after_comparisons FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage before/after"
  ON before_after_comparisons FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER before_after_comparisons_updated_at
  BEFORE UPDATE ON before_after_comparisons FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- BEFORE / AFTER METRICS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE before_after_metrics (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id         UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  metric_name     TEXT NOT NULL,
  before_value    TEXT,
  after_value     TEXT,
  business_impact TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE before_after_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view metrics"
  ON before_after_metrics FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage metrics"
  ON before_after_metrics FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- DEMO APPROVALS  (developer internal QA checklist)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE demo_approvals (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  checklist     JSONB DEFAULT '{}',
  auditor_id    UUID REFERENCES profiles(id),
  auditor_notes TEXT,
  deadline      DATE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  result_notes  TEXT,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE demo_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view demo approvals"
  ON demo_approvals FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage demo approvals"
  ON demo_approvals FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER demo_approvals_updated_at
  BEFORE UPDATE ON demo_approvals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- FOLLOW-UP STEPS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE follow_up_steps (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  step_number  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','active','done','skipped')),
  outcome      TEXT,
  notes        TEXT,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  zoom_link    TEXT,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE follow_up_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view follow-up steps"
  ON follow_up_steps FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage follow-up steps"
  ON follow_up_steps FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- CONTENT ITEMS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE content_items (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('pdf','blog','link')),
  title       TEXT NOT NULL,
  description TEXT,
  url         TEXT,
  file_url    TEXT,
  lead_id     UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view content items"
  ON content_items FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage content items"
  ON content_items FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- CONTENT SENDS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE content_sends (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES profiles(id) NOT NULL,
  content_ids  TEXT[] DEFAULT '{}',
  channel      TEXT NOT NULL CHECK (channel IN ('whatsapp','email','both')),
  message      TEXT,
  scheduled_at TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE content_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view content sends"
  ON content_sends FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage content sends"
  ON content_sends FOR ALL USING (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- DEAL CLOSINGS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE deal_closings (
  id                 UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id            UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  outcome            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (outcome IN ('pending','won','lost')),
  payment_type       TEXT,
  token_amount       DECIMAL(10,2),
  payment_method     TEXT,
  transaction_id     TEXT,
  services           TEXT[] DEFAULT '{}',
  start_date         DATE,
  end_date           DATE,
  duration_days      INTEGER,
  client_phone       TEXT,
  client_email       TEXT,
  revision_notes     TEXT,
  closing_call_notes TEXT,
  lost_reason        TEXT,
  lost_notes         TEXT,
  re_nurture_date    DATE,
  re_nurture_action  TEXT,
  prep_checklist     JSONB DEFAULT '{}',
  closed_by          UUID REFERENCES profiles(id),
  closed_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE deal_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view deal closings"
  ON deal_closings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can manage deal closings"
  ON deal_closings FOR ALL USING (auth.role() = 'authenticated');

CREATE TRIGGER deal_closings_updated_at
  BEFORE UPDATE ON deal_closings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ────────────────────────────────────────────────────────────────
-- ACTIVITY LOGS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE activity_logs (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id    UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES profiles(id) NOT NULL,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view activity logs"
  ON activity_logs FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can insert activity logs"
  ON activity_logs FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ────────────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  lead_id    UUID REFERENCES leads(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  type       TEXT DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ────────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────────
CREATE INDEX idx_leads_status              ON leads(status);
CREATE INDEX idx_leads_assigned_agent      ON leads(assigned_agent_id);
CREATE INDEX idx_audits_lead               ON audits(lead_id);
CREATE INDEX idx_appointments_lead         ON appointments(lead_id);
CREATE INDEX idx_demos_lead                ON demos(lead_id);
CREATE INDEX idx_deals_lead                ON deals(lead_id);
CREATE INDEX idx_revisions_lead            ON revisions(lead_id);
CREATE INDEX idx_project_approvals_status  ON project_approvals(status);
CREATE INDEX idx_project_approvals_lead    ON project_approvals(lead_id);
CREATE INDEX idx_before_after_comp_lead    ON before_after_comparisons(lead_id);
CREATE INDEX idx_before_after_metrics_lead ON before_after_metrics(lead_id);
CREATE INDEX idx_follow_up_steps_lead      ON follow_up_steps(lead_id);
CREATE INDEX idx_content_sends_lead        ON content_sends(lead_id);
CREATE INDEX idx_deal_closings_lead        ON deal_closings(lead_id);
CREATE INDEX idx_activity_logs_lead        ON activity_logs(lead_id);
CREATE INDEX idx_notifications_user        ON notifications(user_id, read);

-- ────────────────────────────────────────────────────────────────
-- STORAGE BUCKET
-- ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('crm-files', 'crm-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read access on crm-files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'crm-files');

CREATE POLICY "Authenticated users can upload to crm-files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'crm-files' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update crm-files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'crm-files' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete crm-files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'crm-files' AND auth.role() = 'authenticated');
