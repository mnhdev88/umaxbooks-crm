-- Add click tracking columns
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS click_count INT DEFAULT 0;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS first_clicked_at TIMESTAMPTZ;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS last_clicked_url TEXT;

-- Add deferred and unsubscribed timestamps
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS deferred_at TIMESTAMPTZ;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

-- Add bounce type (hard = permanent, soft = temporary/blocked)
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS bounce_type TEXT CHECK (bounce_type IN ('hard', 'soft'));

-- Expand status enum to include deferred and unsubscribed
ALTER TABLE email_sends DROP CONSTRAINT IF EXISTS email_sends_status_check;
ALTER TABLE email_sends ADD CONSTRAINT email_sends_status_check
  CHECK (status IN ('sent', 'scheduled', 'failed', 'delivered', 'bounced', 'spam', 'deferred', 'unsubscribed'));
