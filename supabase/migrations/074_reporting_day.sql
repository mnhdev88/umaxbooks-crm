-- 074_reporting_day.sql
-- Business "reporting day" boundary so daily performance doesn't reset at server
-- midnight (UTC on EC2), which lands in the middle of the team's working hours.
--
-- The reporting day is anchored to a business timezone and starts at a set hour,
-- then runs 24h — so a late shift that crosses local midnight stays in ONE day.
-- Defaults: Asia/Kolkata (India) starting at 06:00, i.e. each day runs
-- 06:00 IST → 06:00 IST next day. Admins can change both in Settings.
--
-- Values are read client- and server-side by the Reports date logic, so we add
-- narrow authenticated-read policies (app_settings otherwise exposes only the
-- specific keys allowlisted here; the rest stays service-role only).

INSERT INTO app_settings (key, value) VALUES
  ('report_timezone', 'Asia/Kolkata'),
  ('report_day_start_hour', '6')
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read report_timezone" ON app_settings;
CREATE POLICY "Authenticated can read report_timezone"
  ON app_settings FOR SELECT TO authenticated USING (key = 'report_timezone');

DROP POLICY IF EXISTS "Authenticated can read report_day_start_hour" ON app_settings;
CREATE POLICY "Authenticated can read report_day_start_hour"
  ON app_settings FOR SELECT TO authenticated USING (key = 'report_day_start_hour');
