-- Resend delivery tracking: store the Resend message id so webhook events
-- (email.delivered / bounced / complained / clicked / delivery_delayed) can be
-- matched back to the originating email_sends row.
--
-- Kept separate from sendgrid_message_id so the two providers never collide and
-- the SendGrid-only sync/UI paths stay untouched. All the shared delivery-status
-- columns (status, delivered_at, bounced_at, bounce_type, deferred_at,
-- click_count, first_clicked_at, last_clicked_url) already exist from migrations
-- 041 and 042 and are reused as-is.
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS resend_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_email_sends_resend_message_id ON email_sends(resend_message_id);
