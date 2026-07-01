-- Call-readiness sorting for the Leads queue.
--
-- Goal: an agent working the list should immediately see WHICH leads it's already
-- past the local calling start-time for (default 9:30am in the LEAD's own US time
-- zone), so they can call now instead of waiting — and NOT call leads where it's
-- still before 9:30am or already after hours (US TCPA telemarketing law caps calls
-- at 8am–9pm in the CALLED party's local time; we keep the window inside that).
--
-- Design (see AGENTS.md — timezone is derived from zip_code, "current logic"):
--   * zip_to_timezone(zip)  — IMMUTABLE port of lib/zip-timezone.ts (3-digit ZIP
--                             prefix → IANA zone). Used as a STORED generated column
--                             so every lead always carries its zone with no writes
--                             to maintain and no risk of insert-path drift.
--   * leads.timezone        — generated column, orderable + selectable.
--   * lead_call_rank(tz)    — STABLE (depends on now()): 0 = callable now,
--                             1 = too early (before window), 2 = after hours,
--                             3 = unknown zone. Window bounds live in app_settings
--                             so an admin can tune them in-app (mirrors 071).
--   * leads_call_queue view — leads.* + the joined agent name + call_rank, with
--                             security_invoker so the caller's leads/profiles RLS
--                             still applies. The list query orders by call_rank when
--                             the agent flips on "Call-ready first".

-- ── ZIP → IANA timezone (offline, mirrors lib/zip-timezone.ts) ───────────────
CREATE OR REPLACE FUNCTION zip_to_timezone(zip text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  d text;
  p int;
BEGIN
  IF zip IS NULL THEN RETURN NULL; END IF;
  d := substring(btrim(zip) from '^\d{3,5}');
  IF d IS NULL OR length(d) < 3 THEN RETURN NULL; END IF;
  p := left(d, 3)::int;
  RETURN CASE
    WHEN p BETWEEN 0   AND 5   THEN 'America/New_York'
    WHEN p BETWEEN 6   AND 9   THEN 'America/Puerto_Rico'
    WHEN p BETWEEN 10  AND 319 THEN 'America/New_York'
    WHEN p BETWEEN 320 AND 323 THEN 'America/New_York'
    WHEN p BETWEEN 324 AND 325 THEN 'America/Chicago'
    WHEN p BETWEEN 326 AND 349 THEN 'America/New_York'
    WHEN p BETWEEN 350 AND 369 THEN 'America/Chicago'
    WHEN p BETWEEN 370 AND 373 THEN 'America/Chicago'
    WHEN p = 374               THEN 'America/New_York'
    WHEN p BETWEEN 375 AND 376 THEN 'America/Chicago'
    WHEN p BETWEEN 377 AND 379 THEN 'America/New_York'
    WHEN p BETWEEN 380 AND 385 THEN 'America/Chicago'
    WHEN p BETWEEN 386 AND 397 THEN 'America/Chicago'
    WHEN p BETWEEN 398 AND 399 THEN 'America/New_York'
    WHEN p BETWEEN 400 AND 419 THEN 'America/New_York'
    WHEN p BETWEEN 420 AND 421 THEN 'America/Chicago'
    WHEN p BETWEEN 422 AND 427 THEN 'America/New_York'
    WHEN p BETWEEN 430 AND 458 THEN 'America/New_York'
    WHEN p BETWEEN 459 AND 462 THEN 'America/New_York'
    WHEN p BETWEEN 463 AND 464 THEN 'America/Chicago'
    WHEN p BETWEEN 465 AND 475 THEN 'America/New_York'
    WHEN p BETWEEN 476 AND 477 THEN 'America/Chicago'
    WHEN p BETWEEN 478 AND 498 THEN 'America/New_York'
    WHEN p = 499               THEN 'America/Chicago'
    WHEN p BETWEEN 500 AND 528 THEN 'America/Chicago'
    WHEN p BETWEEN 530 AND 549 THEN 'America/Chicago'
    WHEN p BETWEEN 550 AND 567 THEN 'America/Chicago'
    WHEN p BETWEEN 570 AND 575 THEN 'America/Chicago'
    WHEN p BETWEEN 576 AND 577 THEN 'America/Denver'
    WHEN p BETWEEN 580 AND 586 THEN 'America/Chicago'
    WHEN p BETWEEN 587 AND 588 THEN 'America/Denver'
    WHEN p BETWEEN 590 AND 599 THEN 'America/Denver'
    WHEN p BETWEEN 600 AND 629 THEN 'America/Chicago'
    WHEN p BETWEEN 630 AND 658 THEN 'America/Chicago'
    WHEN p BETWEEN 660 AND 679 THEN 'America/Chicago'
    WHEN p BETWEEN 680 AND 689 THEN 'America/Chicago'
    WHEN p BETWEEN 690 AND 693 THEN 'America/Denver'
    WHEN p BETWEEN 700 AND 714 THEN 'America/Chicago'
    WHEN p BETWEEN 716 AND 729 THEN 'America/Chicago'
    WHEN p BETWEEN 730 AND 749 THEN 'America/Chicago'
    WHEN p BETWEEN 750 AND 797 THEN 'America/Chicago'
    WHEN p BETWEEN 798 AND 799 THEN 'America/Denver'
    WHEN p BETWEEN 800 AND 816 THEN 'America/Denver'
    WHEN p BETWEEN 820 AND 831 THEN 'America/Denver'
    WHEN p BETWEEN 832 AND 837 THEN 'America/Denver'
    WHEN p = 838               THEN 'America/Los_Angeles'
    WHEN p BETWEEN 840 AND 847 THEN 'America/Denver'
    WHEN p BETWEEN 850 AND 864 THEN 'America/Phoenix'
    WHEN p BETWEEN 870 AND 884 THEN 'America/Denver'
    WHEN p BETWEEN 889 AND 898 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 900 AND 961 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 967 AND 968 THEN 'Pacific/Honolulu'
    WHEN p = 969               THEN 'Pacific/Guam'
    WHEN p BETWEEN 970 AND 979 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 980 AND 994 THEN 'America/Los_Angeles'
    WHEN p BETWEEN 995 AND 999 THEN 'America/Anchorage'
    ELSE NULL
  END;
END;
$$;

-- Stored generated column: always in sync with zip_code, no insert-path changes.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS timezone text
  GENERATED ALWAYS AS (zip_to_timezone(zip_code)) STORED;

-- ── Configurable calling window (admin-editable, like daily_call_target) ─────
INSERT INTO app_settings (key, value) VALUES
  ('call_window_start', '09:30'),
  ('call_window_end',   '20:00')
ON CONFLICT (key) DO NOTHING;

-- Narrow read policies so agents (not just admins) get the configured window,
-- without exposing the rest of app_settings (which holds secrets). Mirrors 071.
DROP POLICY IF EXISTS "Authenticated can read call_window_start" ON app_settings;
CREATE POLICY "Authenticated can read call_window_start"
  ON app_settings FOR SELECT TO authenticated USING (key = 'call_window_start');

DROP POLICY IF EXISTS "Authenticated can read call_window_end" ON app_settings;
CREATE POLICY "Authenticated can read call_window_end"
  ON app_settings FOR SELECT TO authenticated USING (key = 'call_window_end');

-- ── Call-readiness rank (0 call now · 1 too early · 2 after hours · 3 unknown) ─
CREATE OR REPLACE FUNCTION lead_call_rank(tz text)
RETURNS int
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  win_start time;
  win_end   time;
  local_t   time;
BEGIN
  IF tz IS NULL THEN RETURN 3; END IF;

  SELECT value::time INTO win_start FROM app_settings WHERE key = 'call_window_start';
  SELECT value::time INTO win_end   FROM app_settings WHERE key = 'call_window_end';
  win_start := COALESCE(win_start, TIME '09:30');
  win_end   := COALESCE(win_end,   TIME '20:00');

  BEGIN
    -- Wall-clock time of day in the lead's own zone (DST-correct via AT TIME ZONE).
    local_t := (now() AT TIME ZONE tz)::time;
  EXCEPTION WHEN OTHERS THEN
    RETURN 3; -- unrecognised zone name
  END;

  IF    local_t <  win_start THEN RETURN 1;  -- before the window opens
  ELSIF local_t >  win_end   THEN RETURN 2;  -- after hours
  ELSE                            RETURN 0;  -- callable right now
  END IF;
END;
$$;

-- ── Call-queue view: leads + agent name + live call_rank, RLS via invoker ─────
-- The join is baked in (rather than relying on PostgREST embed inference through a
-- view) so the existing list filters/select keep working unchanged.
CREATE OR REPLACE VIEW leads_call_queue
WITH (security_invoker = true)
AS
SELECT
  l.*,
  p.full_name           AS assigned_agent_name,
  lead_call_rank(l.timezone) AS call_rank
FROM leads l
LEFT JOIN profiles p ON p.id = l.assigned_agent_id;

GRANT SELECT ON leads_call_queue TO authenticated;

COMMENT ON VIEW leads_call_queue IS
  'leads + assigned agent name + call_rank (0 call-now,1 early,2 after-hours,3 unknown) for the "Call-ready first" sort. security_invoker → leads/profiles RLS applies.';
