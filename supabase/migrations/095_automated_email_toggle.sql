-- 095_automated_email_toggle.sql
-- Global kill switch for AUTOMATED outbound email — every send the app makes on
-- its own, with nobody clicking "Send":
--   * cron: send-scheduled-emails, followup-check (5-day drip), eod-dialer-report
--   * cold-outreach email auto-sent after an AI voice call
--   * internal alerts: demo scheduled/revision, payment received, demo approval,
--     demo declined
--
-- It does NOT touch human-initiated email — ComposeModal, contract signing links,
-- client portal invites, send-content, and the provider test button keep working.
--
-- Seeded as 'false' on purpose: this migration ships to STOP the automation. Flip
-- it back on from Settings → Automated Emails when you're ready.
--
-- Service-role only (no SELECT policy): the value is read server-side by
-- lib/automated-email.ts and read/written by /api/settings/automated-email, both
-- of which use the service client. Nothing client-side reads app_settings for it.
--
-- Missing key = enabled, so an environment that never ran this migration behaves
-- exactly as it did before. For an instant stop that needs no DB access, set the
-- env var AUTOMATED_EMAIL=off — it overrides this row.

INSERT INTO app_settings (key, value) VALUES ('automated_email_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
