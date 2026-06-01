-- Add sendgrid to the email_providers provider check constraint
ALTER TABLE email_providers DROP CONSTRAINT IF EXISTS email_providers_provider_check;
ALTER TABLE email_providers ADD CONSTRAINT email_providers_provider_check
  CHECK (provider IN ('gmail', 'aws_ses', 'resend', 'sendgrid', 'custom'));
