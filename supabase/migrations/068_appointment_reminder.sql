-- 15-minute demo/call reminder.
-- A cron (/api/cron/demo-reminder, every 5 min) scans upcoming appointments and
-- notifies the people running the demo ~15 minutes before it starts. This column
-- is the dedup guard: it's stamped once the reminder has been sent so the same
-- appointment is never reminded twice across cron ticks.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Partial index: the cron only ever queries the not-yet-reminded rows.
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_due
  ON appointments (appointment_datetime)
  WHERE reminder_sent_at IS NULL;
