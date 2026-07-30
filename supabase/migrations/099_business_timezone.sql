-- 099_business_timezone.sql
-- Give the office's working hours (098) a timezone of their own, and move them to
-- 09:30–18:30 US Eastern.
--
-- WHY: 098 deliberately reused report_timezone rather than duplicating it, on the
-- grounds that "the business's timezone" is one fact. That held only while both
-- meanings pointed at the same zone. They now diverge:
--
--   * report_timezone must stay Asia/Kolkata. The reporting day starts at 06:00 IST
--     (074) precisely so a late US-calling shift that crosses IST midnight stays in
--     one day. Repointing it at Eastern would move that boundary into the middle of
--     the shift and reset every daily counter mid-shift.
--   * The phones, though, are staffed against US business hours: 09:30–18:30 Eastern,
--     which is when the leads being called are actually awake.
--
-- So business hours get business_timezone. It DEFAULTS to report_timezone when unset,
-- which keeps every existing install on exactly the behaviour 098 gave it — the key
-- only changes anything once someone sets it.
--
-- Eastern is stored rather than the equivalent IST window (19:00–04:00) for two
-- reasons. First, Eastern observes DST and IST does not, so one side has to move twice
-- a year; pinning Eastern keeps the US caller's experience identical year-round and
-- lets the team's IST shift slide (19:00–04:00 in summer, 20:00–05:00 in winter),
-- which is the way round the business actually wants it. Second, 09:30–18:30 doesn't
-- cross midnight, so isOpenNow's existing same-day comparison keeps working; the IST
-- form would have needed wraparound handling in the hot path of every inbound call.
--
-- business_days stays 1–5 and is still read in the business timezone, so it now means
-- Mon–Fri EASTERN. In IST that is Monday evening through Saturday morning — intended.

INSERT INTO app_settings (key, value) VALUES
  -- Unset means "fall back to report_timezone", preserving 098's behaviour.
  ('business_timezone', 'America/New_York')
ON CONFLICT (key) DO NOTHING;

-- 098 seeded 09:30–18:00 meaning IST. Those rows exist, so ON CONFLICT DO NOTHING
-- would skip them; the close time has to be moved explicitly. Guarded on the old
-- values so a deployment that already tuned its hours by hand isn't overwritten.
UPDATE app_settings SET value = '18:30'
  WHERE key = 'business_close' AND value = '18:00';

-- Readable by any authenticated user, matching the 098 policy it extends. Replaces
-- that policy rather than adding a second one: two FOR SELECT policies on the same
-- table are OR'd, so leaving the old one in place would work but hides which keys
-- are actually exposed. Keep the full key list here.
DROP POLICY IF EXISTS "Authenticated can read business hours" ON app_settings;
CREATE POLICY "Authenticated can read business hours" ON app_settings
  FOR SELECT TO authenticated
  USING (key IN ('business_open', 'business_close', 'business_days', 'business_timezone'));

COMMENT ON TABLE app_settings IS
  'Key/value app configuration. Time-related keys: report_timezone + report_day_start_hour (074, reporting day boundary, Asia/Kolkata), call_window_start/end (072, when it is OK to dial a lead in THEIR zone), business_open/close/days + business_timezone (098/099, when OUR office is staffed; falls back to report_timezone when the timezone is unset).';
