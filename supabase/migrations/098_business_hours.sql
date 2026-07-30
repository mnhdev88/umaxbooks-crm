-- 098_business_hours.sql
-- When the office is open, so an inbound call outside those hours goes straight to
-- voicemail instead of ringing a room nobody is in.
--
-- WHY: the voicemail recorder (092) already exists, but the only way to reach it is to
-- ring out through the owning agent (15s) and then the whole hunt group (20s). At 9pm
-- that's 35 seconds of ringing dead phones before the caller gets a beep — they hang up
-- long before that, and the call is logged 'abandoned' with nothing to call back.
--
-- Deliberately NOT reusing call_window_start/end (072): those are the hours it's legal
-- and polite to dial a LEAD, evaluated in that lead's own US timezone (TCPA). These are
-- the hours OUR office is staffed, evaluated in our own timezone. Same shape, unrelated
-- meaning — one setting serving both would break the moment they diverge.
--
-- The timezone is deliberately absent: it reuses app_settings.report_timezone (074),
-- which already means "the business's timezone". A second copy would drift.

INSERT INTO app_settings (key, value) VALUES
  ('business_open',  '09:30'),   -- HH:MM, inclusive
  ('business_close', '18:00'),   -- HH:MM, inclusive
  -- ISO day numbers, 1 = Monday … 7 = Sunday. Comma-separated so a non-contiguous
  -- week (e.g. closed Wednesday) stays expressible without a schema change.
  ('business_days',  '1,2,3,4,5')
ON CONFLICT (key) DO NOTHING;

-- app_settings has no blanket SELECT policy (it also holds secrets), so each
-- readable key needs its own narrow policy. Matches 074's approach.
DROP POLICY IF EXISTS "Authenticated can read business hours" ON app_settings;
CREATE POLICY "Authenticated can read business hours" ON app_settings
  FOR SELECT TO authenticated
  USING (key IN ('business_open', 'business_close', 'business_days'));

COMMENT ON TABLE app_settings IS
  'Key/value app configuration. Time-related keys: report_timezone + report_day_start_hour (074, reporting day boundary), call_window_start/end (072, when it is OK to dial a lead in THEIR zone), business_open/close/days (098, when OUR office is staffed, in report_timezone).';
