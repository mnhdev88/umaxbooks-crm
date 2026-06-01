-- Add delivery tracking columns for SendGrid Web API webhook events
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS sendgrid_message_id TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;

-- Expand status check to include delivery states from SendGrid webhooks
ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('sent', 'scheduled', 'failed', 'delivered', 'bounced', 'spam'));

CREATE INDEX IF NOT EXISTS idx_email_sends_sendgrid_message_id ON email_sends(sendgrid_message_id);
