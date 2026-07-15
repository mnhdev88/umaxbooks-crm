-- ============================================================================
-- FULL DATABASE AUDIT — READ-ONLY DIAGNOSTICS
--
-- Supabase Dashboard → SQL Editor → New Query. Run ONE BLOCK AT A TIME and
-- paste the result back. Nothing here writes, locks, or modifies anything —
-- every statement is a SELECT against a catalog or stats view.
--
-- WHY THIS EXISTS: the repo cannot tell us the live schema. cloud_schema.sql is
-- hand-maintained and ~78 migrations stale, migrations are applied by hand (so
-- some may never have landed), and replaying migrations/*.sql on an empty DB
-- fails at 003 because before_after_metrics is created only in cloud_schema.sql.
-- The catalogs below are the only source of truth.
--
-- Blocks 1-4 are the priority. Blocks 5-9 are performance. Blocks 10-13 are
-- security/correctness. Block 14 is drift spot-checks.
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 1 — THE MONEY QUERY: what is actually slow?                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Ranks real queries by total time spent. Everything else in this file is a
-- hypothesis; this is evidence. If it errors with "relation pg_stat_statements
-- does not exist", run:  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- then wait for a few minutes of real traffic and re-run.
SELECT round(total_exec_time)::int                        AS total_ms,
       calls,
       round(mean_exec_time)::numeric(10,2)               AS avg_ms,
       round((100 * total_exec_time /
              nullif(sum(total_exec_time) OVER (), 0))::numeric, 1) AS pct_of_total,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 240)  AS query
FROM   pg_stat_statements
WHERE  query NOT ILIKE '%pg_stat_statements%'
ORDER  BY total_exec_time DESC
LIMIT  25;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 2 — EVERY RLS POLICY ON EVERY TABLE                               │
-- └──────────────────────────────────────────────────────────────────────────┘
-- The most important block. Resolves (a) which tables still have the unwrapped
-- auth.uid()/get_my_role() per-row pattern that migration 079 fixed for leads,
-- (b) whether production carries policy NAMES the migrations never created
-- (079 drops "Developers can update Contacted leads", which no migration ever
-- creates — proof the live catalog has drifted), and (c) the security questions
-- in Block 10. DROP POLICY matches on NAME, so we cannot safely write a single
-- migration until we see this output.
SELECT tablename,
       policyname,
       cmd,
       permissive,
       roles,
       qual        AS using_expr,
       with_check
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY tablename, cmd, policyname;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 3 — PERMISSIVE POLICY COUNT PER TABLE/COMMAND                     │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Postgres ORs all permissive policies for a command and evaluates EVERY one of
-- them PER ROW. N permissive SELECT policies = N x the per-row cost. Note FOR
-- ALL policies count toward SELECT too. Anything >= 3 on a large table is a
-- prime target.
SELECT tablename,
       cmd,
       count(*) FILTER (WHERE permissive = 'PERMISSIVE') AS permissive_policies,
       count(*) FILTER (WHERE permissive = 'RESTRICTIVE') AS restrictive_policies,
       string_agg(policyname, ' | ' ORDER BY policyname)  AS policy_names
FROM   pg_policies
WHERE  schemaname = 'public'
GROUP  BY tablename, cmd
HAVING count(*) > 1
ORDER  BY count(*) DESC, tablename;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 4 — TABLE SIZES + SEQUENTIAL SCAN PRESSURE                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- RLS per-row overhead scales with ROWS SCANNED, so row count decides which
-- table to fix first. High seq_scan x large n_live_tup = missing index or a
-- full-scan query. dead_pct flags vacuum problems.
SELECT relname                                        AS table_name,
       n_live_tup                                     AS approx_rows,
       pg_size_pretty(pg_total_relation_size(relid))  AS total_size,
       pg_size_pretty(pg_indexes_size(relid))         AS index_size,
       seq_scan,
       seq_tup_read,
       idx_scan,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 1) END AS dead_pct,
       last_autovacuum,
       last_autoanalyze
FROM   pg_stat_user_tables
ORDER  BY n_live_tup DESC
LIMIT  40;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 5 — UNINDEXED FOREIGN KEYS                                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Postgres indexes the REFERENCED side (the PK) automatically but NOT the
-- referencing column. Every row here = seq scan on join + slow cascading delete.
-- Static analysis says ~23 of these exist; this confirms against reality.
SELECT c.conrelid::regclass::text  AS table_name,
       a.attname                   AS fk_column,
       c.confrelid::regclass::text AS references_table,
       pg_size_pretty(pg_total_relation_size(c.conrelid)) AS table_size
FROM   pg_constraint c
JOIN   lateral unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN   pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE  c.contype = 'f'
  AND  c.connamespace = 'public'::regnamespace
  AND  NOT EXISTS (
         SELECT 1 FROM pg_index i
         WHERE i.indrelid = c.conrelid
           AND i.indkey[0] = k.attnum      -- FK column must be the LEADING key
       )
ORDER  BY pg_total_relation_size(c.conrelid) DESC, table_name, fk_column;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 6 — UNUSED INDEXES (pure write overhead)                          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- idx_scan = 0 means the planner has never chosen it since stats were last
-- reset. Every one still costs write throughput on INSERT/UPDATE and RAM.
-- CAVEAT: check stats age in Block 7 first — a freshly-reset counter makes
-- everything look unused. Never drop a UNIQUE/PK index that enforces a
-- constraint (e.g. idx_leads_phone_unique / idx_leads_email_unique) even at 0.
SELECT s.relname                                    AS table_name,
       s.indexrelname                               AS index_name,
       s.idx_scan                                   AS times_used,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
       i.indisunique                                AS is_unique,
       i.indisprimary                               AS is_pk
FROM   pg_stat_user_indexes s
JOIN   pg_index i ON i.indexrelid = s.indexrelid
WHERE  s.idx_scan = 0
ORDER  BY pg_relation_size(s.indexrelid) DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 7 — STATS AGE (context for Blocks 1, 4, 6)                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- If stats were reset an hour ago, "unused index" and "slow query" rankings are
-- meaningless. Longer window = more trustworthy.
SELECT stats_reset AS db_stats_since, now() - stats_reset AS window
FROM   pg_stat_database WHERE datname = current_database();

SELECT stats_reset AS pg_stat_statements_since, now() - stats_reset AS window
FROM   pg_stat_statements_info;   -- errors on older PG; safe to skip


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 8 — DUPLICATE / REDUNDANT INDEXES                                 │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Exact duplicates under different names. Static analysis suspects
-- project_approvals(lead_id) is indexed twice (idx_project_approvals_lead from
-- cloud_schema.sql:546 and idx_project_approvals_lead_id from 004:19) — IF NOT
-- EXISTS guards on NAME, so it never caught this.
SELECT indrelid::regclass::text AS table_name,
       count(*)                 AS copies,
       string_agg(indexrelid::regclass::text, ' | ') AS index_names,
       pg_size_pretty(sum(pg_relation_size(indexrelid))) AS wasted_total
FROM   pg_index
WHERE  indrelid::regclass::text NOT LIKE 'pg_%'
GROUP  BY indrelid, indkey::text, indclass::text, indexprs::text, indpred::text
HAVING count(*) > 1
ORDER  BY sum(pg_relation_size(indexrelid)) DESC;

-- Redundant prefixes: an index on (a) is redundant when (a,b) also exists.
SELECT a.indrelid::regclass::text        AS table_name,
       a.indexrelid::regclass::text      AS redundant_index,
       b.indexrelid::regclass::text      AS covered_by,
       pg_size_pretty(pg_relation_size(a.indexrelid)) AS reclaimable
FROM   pg_index a
JOIN   pg_index b
  ON   a.indrelid = b.indrelid
 AND   a.indexrelid <> b.indexrelid
 AND   array_to_string(b.indkey, ' ') LIKE array_to_string(a.indkey, ' ') || ' %'
WHERE  NOT a.indisunique AND NOT a.indisprimary
  AND  a.indpred IS NULL AND b.indpred IS NULL
  AND  a.indexprs IS NULL AND b.indexprs IS NULL
ORDER  BY pg_relation_size(a.indexrelid) DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 9 — REALTIME PUBLICATION + CACHE HIT RATIO                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Realtime WAL decode was measured at ~54% of cumulative DB CPU. Every table
-- here generates WAL that Realtime decodes and RLS-checks PER SUBSCRIBER.
-- Expect only messages/conversations/conversation_participants. Anything else
-- listed is decode cost you may not be using.
SELECT schemaname, tablename
FROM   pg_publication_tables
WHERE  pubname = 'supabase_realtime'
ORDER  BY tablename;

-- Should be > 0.99. Below ~0.95 means the working set no longer fits in RAM,
-- which is an instance-size conversation, not an index one.
SELECT sum(heap_blks_hit)  AS cache_hits,
       sum(heap_blks_read) AS disk_reads,
       round(sum(heap_blks_hit)::numeric /
             nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 4) AS cache_hit_ratio
FROM   pg_statio_user_tables;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 10 — SECURITY: can clients write to core tables?  ** URGENT **     │
-- └──────────────────────────────────────────────────────────────────────────┘
-- cloud_schema.sql grants FOR ALL USING (auth.role() = 'authenticated') on
-- audits(:176) appointments(:198) demos(:217) deals(:244) revisions(:269).
-- Client-portal users authenticate through Supabase, so auth.role() is
-- 'authenticated' for THEM TOO. If these are live, any client can INSERT/
-- UPDATE/DELETE any audit/appointment/demo/deal/revision for ANY lead, and can
-- SELECT every deal in the system — which is exactly what 027_client_portal.sql
-- was written to prevent. 069:4-7 says these policies "have drifted in
-- production" and routed around them rather than fixing them.
-- An empty result here is the good outcome.
SELECT tablename, policyname, cmd, permissive, roles, qual AS using_expr
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('audits','appointments','demos','deals','revisions','live_sites')
  AND  (qual ILIKE '%auth.role()%' OR qual ILIKE '%authenticated%')
ORDER  BY tablename, cmd;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 11 — SECURITY: storage bucket exposure  ** URGENT **              │
-- └──────────────────────────────────────────────────────────────────────────┘
-- cloud_schema.sql:558-576 creates crm-files with public = true and
-- FOR SELECT USING (bucket_id = 'crm-files') — unauthenticated read of the
-- WHOLE bucket. It holds job applicants' resumes (057:56), signed contract PDFs
-- with client_signature / card_last_4 / client_ip (026:48), and audit PDFs.
-- It also lets ANY authenticated user INSERT/UPDATE/DELETE ANY object, so one
-- agent can overwrite another's signed contract.
-- Compare 062_chat_attachments.sql:56-76, which does this correctly.
SELECT id AS bucket, public, file_size_limit, allowed_mime_types, created_at
FROM   storage.buckets ORDER BY id;

SELECT policyname, cmd, roles, qual AS using_expr, with_check
FROM   pg_policies
WHERE  schemaname = 'storage' AND tablename = 'objects'
ORDER  BY policyname;

-- How much is actually exposed right now?
SELECT bucket_id, count(*) AS objects,
       pg_size_pretty(sum((metadata->>'size')::bigint)) AS total_bytes
FROM   storage.objects GROUP BY bucket_id ORDER BY count(*) DESC;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 12 — SECURITY DEFINER functions with mutable search_path          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Supabase lint function_search_path_mutable. get_my_role() (001:15) is the
-- important one — it runs inside EVERY RLS policy in the system. Also confirms
-- the perf question: any SECDEF function used in a policy must be STABLE.
SELECT p.proname                          AS function_name,
       p.prosecdef                        AS security_definer,
       CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE'
                          WHEN 's' THEN 'STABLE'
                          WHEN 'v' THEN 'VOLATILE' END AS volatility,
       coalesce(array_to_string(p.proconfig, ', '), '** MUTABLE search_path **') AS config
FROM   pg_proc p
WHERE  p.pronamespace = 'public'::regnamespace
  AND  p.prosecdef
ORDER  BY (p.proconfig IS NULL) DESC, p.proname;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 13 — TRIGGERS + CRON + EXTENSIONS                                 │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Looking for triggers with no WHEN clause on hot write paths. Specifically
-- trg_lead_status_change fires on EVERY leads UPDATE and guards inside the
-- function (002:31) rather than in the trigger definition; it cascades into
-- notifications -> notifications_push_dispatch -> net.http_post PER ROW (058:62).
-- The pg_net enqueue is an INSERT inside YOUR transaction, and 058:78 swallows
-- all exceptions, so a broken pg_net is completely invisible.
SELECT c.relname                     AS table_name,
       t.tgname                      AS trigger_name,
       p.proname                     AS function_name,
       pg_get_triggerdef(t.oid) LIKE '%WHEN%' AS has_when_clause,
       pg_get_triggerdef(t.oid)      AS definition
FROM   pg_trigger t
JOIN   pg_class c ON c.oid = t.tgrelid
JOIN   pg_proc  p ON p.oid = t.tgfoid
WHERE  NOT t.tgisinternal
  AND  c.relnamespace = 'public'::regnamespace
ORDER  BY c.relname, t.tgname;

-- Was pg_cron ever actually enabled? 002:143 says the notification purge only
-- works after enabling it by hand in the dashboard. If this is empty, the
-- 3-day notification purge has NEVER run and the table has grown unbounded.
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT jobid, schedule, command, active FROM cron.job ORDER BY jobid;  -- errors if pg_cron absent

-- pg_net backlog: a large queue means push dispatch is failing silently.
SELECT count(*) AS queued FROM net.http_request_queue;  -- errors if pg_net absent


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ BLOCK 14 — DRIFT SPOT-CHECKS                                            │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Six migration numbers are used TWICE: 002, 021, 027, 034, 062, 066. Applying
-- by hand and seeing "002 done" is exactly how notifications.link went missing
-- (060:3-10 documents the fallout: chat broken AND web push silently dead).
-- The same trap is still armed for the other five pairs. Each query below
-- checks whether the SECOND file of a duplicate pair actually landed.

-- 034_duplicate_leads_constraints + 076 + 077 + 080: do the leads columns exist?
SELECT column_name, data_type, column_default, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'leads'
  AND  column_name IN ('is_merged','merged_into_id','alt_emails','alt_phones',
                       'state','priority','lead_number','created_by','timezone')
ORDER  BY column_name;

-- Total leads column count — static analysis says ~54. Wide rows mean every
-- UPDATE rewrites the whole tuple plus every index unless HOT applies.
SELECT count(*) AS leads_column_count FROM information_schema.columns
WHERE table_name = 'leads';

-- 080: did the priority migration land? Expect Medium in the CHECK.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conrelid = 'leads'::regclass AND contype = 'c'
ORDER  BY conname;

-- 027_signing_metadata + 062_chat_attachments: did the second-of-pair land?
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'contracts' AND column_name = 'signing_metadata')
   OR (table_name = 'messages'  AND column_name IN ('attachment_path','attachment_name'))
   OR (table_name = 'notifications' AND column_name = 'link')
ORDER  BY table_name, column_name;

-- 057_careers has bare INSERTs with no ON CONFLICT (057:76-140). If it was
-- applied twice, the public careers site is showing every job twice.
SELECT title, count(*) FROM job_postings GROUP BY title HAVING count(*) > 1;

-- 072: leads_call_queue was created as SELECT l.* — Postgres expands * at
-- CREATE time, so the view does NOT track columns added later by 076/077.
-- If 'state' is missing here, the leads page "Call-ready first" sort combined
-- with any State filter throws: column leads_call_queue.state does not exist.
SELECT column_name FROM information_schema.columns
WHERE  table_name = 'leads_call_queue'
  AND  column_name IN ('state','alt_emails','alt_phones');

-- Any table with RLS enabled but ZERO policies (deny-all for authenticated).
-- app_settings / email_tracking / kpi_* are intentional — anything else is a bug.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       count(p.policyname) AS policy_count
FROM   pg_class c
LEFT   JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
WHERE  c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
GROUP  BY c.relname, c.relrowsecurity
HAVING c.relrowsecurity AND count(p.policyname) = 0
ORDER  BY c.relname;

-- Any table with RLS DISABLED entirely (silently readable by anyone).
SELECT c.relname AS table_name
FROM   pg_class c
WHERE  c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  AND  NOT c.relrowsecurity
ORDER  BY c.relname;
