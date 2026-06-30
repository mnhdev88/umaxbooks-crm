-- Configurable daily call target for the Call Performance dashboard.
--
-- The dashboard compares each agent/manager's call volume against a per-day
-- target. Rather than hard-code a number, store it in app_settings so an admin
-- can change it in-app without a deploy. Default 50 calls/day.
--
-- app_settings has RLS enabled but (deliberately) no blanket SELECT policy —
-- it also holds secrets like push_dispatch_secret. We add a NARROW read policy
-- exposing ONLY this one key to authenticated users, so the dashboard can read
-- the target client-side without leaking the rest of the table.

INSERT INTO app_settings (key, value) VALUES ('daily_call_target', '50')
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read daily_call_target" ON app_settings;
CREATE POLICY "Authenticated can read daily_call_target"
  ON app_settings FOR SELECT
  TO authenticated
  USING (key = 'daily_call_target');

COMMENT ON TABLE app_settings IS 'Key/value app config. Most rows are secrets (service-role only); only daily_call_target is authenticated-readable.';
