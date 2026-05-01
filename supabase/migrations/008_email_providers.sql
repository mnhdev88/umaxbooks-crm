CREATE TABLE IF NOT EXISTS email_providers (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name        TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'gmail'
                CHECK (provider IN ('gmail', 'aws_ses', 'resend', 'custom')),
  host        TEXT,
  port        INTEGER DEFAULT 587,
  secure      BOOLEAN DEFAULT false,
  username    TEXT,
  password    TEXT,
  api_key     TEXT,
  from_email  TEXT NOT NULL,
  from_name   TEXT NOT NULL DEFAULT 'UMAX CRM',
  is_default  BOOLEAN DEFAULT false,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_providers_default ON email_providers(is_default);

-- Only one default at a time
CREATE OR REPLACE FUNCTION enforce_single_default_email_provider()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE email_providers SET is_default = false WHERE id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_default_email_provider ON email_providers;
CREATE TRIGGER trg_single_default_email_provider
  AFTER INSERT OR UPDATE ON email_providers
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION enforce_single_default_email_provider();

ALTER TABLE email_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_email_providers" ON email_providers
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
