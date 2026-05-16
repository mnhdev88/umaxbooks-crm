-- Extend live_sites with domain, hosting, SSL, and maintenance tracking fields
ALTER TABLE live_sites
  ADD COLUMN IF NOT EXISTS domain_registrar         TEXT,
  ADD COLUMN IF NOT EXISTS domain_expiry            DATE,
  ADD COLUMN IF NOT EXISTS hosting_expiry           DATE,
  ADD COLUMN IF NOT EXISTS ssl_expiry               DATE,
  ADD COLUMN IF NOT EXISTS hosting_cpanel_url       TEXT,
  ADD COLUMN IF NOT EXISTS maintenance_plan         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS maintenance_renewal_date DATE,
  ADD COLUMN IF NOT EXISTS maintenance_monthly_amt  DECIMAL(10,2);

-- Client email accounts (info@, support@, etc. — no passwords stored)
CREATE TABLE IF NOT EXISTS client_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  email_address TEXT NOT NULL,
  label         TEXT,
  provider      TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage client emails"
  ON client_emails FOR ALL
  USING (get_my_role() IN ('admin', 'agent', 'sales_agent', 'developer'));

CREATE POLICY "Clients can view their own email accounts"
  ON client_emails FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'client'
        AND profiles.lead_id = client_emails.lead_id
    )
  );

-- Tracks which expiry reminders have already been sent to avoid duplicates
CREATE TABLE IF NOT EXISTS expiry_reminders_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  expiry_type TEXT NOT NULL CHECK (expiry_type IN ('domain', 'hosting', 'ssl', 'maintenance')),
  days_before INTEGER NOT NULL,
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (lead_id, expiry_type, days_before)
);

ALTER TABLE expiry_reminders_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage reminder log"
  ON expiry_reminders_sent FOR ALL
  USING (get_my_role() = 'admin');

-- Indexes for fast daily expiry queries
CREATE INDEX IF NOT EXISTS idx_live_sites_domain_expiry   ON live_sites(domain_expiry)            WHERE domain_expiry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_sites_hosting_expiry  ON live_sites(hosting_expiry)           WHERE hosting_expiry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_sites_ssl_expiry      ON live_sites(ssl_expiry)               WHERE ssl_expiry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_sites_maint_renewal   ON live_sites(maintenance_renewal_date) WHERE maintenance_renewal_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_emails_lead         ON client_emails(lead_id);
