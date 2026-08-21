-- 105_rls_initplan_wrap_auth_calls.sql
-- Finish the job 079 started on `leads`: stop RLS re-evaluating auth.uid(),
-- auth.role() and get_my_role() once PER ROW.
--
-- WHY: 079 fixed leads only, so every other table still paid the per-row cost.
-- A scan of activity_logs (20k rows) ran get_my_role() 20k times instead of
-- once. The performance advisor flagged 71 policies across 34 tables; PostgREST
-- logged 2,861 "Thread killed by timeout manager" errors in 24h, with worst-case
-- latencies of 5-7s on leads, conversations and activity_logs. Those timeouts
-- are what users experienced as the CRM hanging or coming up empty.
--
-- Wrapping a call in (select ...) makes Postgres hoist it to an InitPlan,
-- evaluated once per statement. The predicate is otherwise IDENTICAL, so no
-- policy changes who it lets through. This is a pure rewrite of expressions
-- already in place: it adds no policy, drops no policy, changes no role.
--
-- Written as a loop over pg_policies rather than 86 hand-written ALTER POLICY
-- statements so it cannot drift from what is actually deployed, and so it stays
-- correct if a policy is edited later. Idempotent — already-wrapped expressions
-- are left alone, so re-running is a no-op.
--
-- See also lib/supabase/auth.ts and proxy.ts, which cut the request volume that
-- was arriving at these policies in the first place.

CREATE OR REPLACE FUNCTION _rls_wrap(expr text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  -- Protect the already-wrapped forms (as Postgres renders them back) so the
  -- bare replacements below cannot match the call sitting inside them, then
  -- restore. Without this the rewrite would nest: (select (select auth.uid())).
  SELECT replace(replace(replace(replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          replace(replace(replace(replace(coalesce(expr,''),
            '( SELECT auth.uid() AS uid)','@@U@@'),
            '( SELECT auth.role() AS role)','@@R@@'),
            '( SELECT get_my_role() AS get_my_role)','@@G@@'),
            '( SELECT auth.jwt() AS jwt)','@@J@@'),
        'auth\.uid\(\)','(select auth.uid())','g'),
      'auth\.role\(\)','(select auth.role())','g'),
    'get_my_role\(\)','(select get_my_role())','g'),
    '@@U@@','( SELECT auth.uid() AS uid)'),
    '@@R@@','( SELECT auth.role() AS role)'),
    '@@G@@','( SELECT get_my_role() AS get_my_role)'),
    '@@J@@','( SELECT auth.jwt() AS jwt)')
$fn$;

DO $$
DECLARE
  r    record;
  stmt text;
  n    int := 0;
BEGIN
  FOR r IN
    SELECT tablename,
           policyname,
           coalesce(qual,'')       AS old_qual,
           coalesce(with_check,'') AS old_check,
           _rls_wrap(qual)         AS new_qual,
           _rls_wrap(with_check)   AS new_check
      FROM pg_policies
     WHERE schemaname = 'public'
  LOOP
    CONTINUE WHEN r.new_qual = r.old_qual AND r.new_check = r.old_check;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    -- Only re-state the clauses the policy already had. A policy created with
    -- USING alone keeps a NULL with_check (Postgres then checks against USING),
    -- and adding one here would quietly change its behaviour.
    IF r.old_qual  <> '' THEN stmt := stmt || ' USING ('      || r.new_qual  || ')'; END IF;
    IF r.old_check <> '' THEN stmt := stmt || ' WITH CHECK (' || r.new_check || ')'; END IF;

    EXECUTE stmt;
    n := n + 1;
  END LOOP;

  RAISE NOTICE 'rewrote % policies', n;   -- 86 on the cloud DB, 2026-08-21
END $$;

DROP FUNCTION _rls_wrap(text);
