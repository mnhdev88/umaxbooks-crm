-- Email Templates (admin creates, agents pick)
CREATE TABLE IF NOT EXISTS email_templates (
  id         UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name       TEXT NOT NULL,
  subject    TEXT NOT NULL DEFAULT '',
  html_body  TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_templates"   ON email_templates FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_manage_templates" ON email_templates FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Email Drafts (one per lead, UPSERT)
CREATE TABLE IF NOT EXISTS email_drafts (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL UNIQUE,
  saved_by    UUID REFERENCES profiles(id),
  provider_id UUID REFERENCES email_providers(id),
  to_email    TEXT DEFAULT '',
  cc          TEXT DEFAULT '',
  bcc         TEXT DEFAULT '',
  subject     TEXT DEFAULT '',
  html_body   TEXT DEFAULT '',
  attachments JSONB DEFAULT '[]',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_manage_drafts" ON email_drafts FOR ALL USING (auth.role() = 'authenticated');

-- Email Sends (history + scheduled)
CREATE TABLE IF NOT EXISTS email_sends (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  sent_by     UUID REFERENCES profiles(id),
  provider_id UUID REFERENCES email_providers(id),
  from_email  TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  cc          TEXT,
  bcc         TEXT,
  subject     TEXT NOT NULL,
  html_body   TEXT,
  attachments JSONB DEFAULT '[]',
  status      TEXT DEFAULT 'sent' CHECK (status IN ('sent','scheduled','failed')),
  scheduled_at TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_sends_lead ON email_sends(lead_id);
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_manage_email_sends" ON email_sends FOR ALL USING (auth.role() = 'authenticated');
