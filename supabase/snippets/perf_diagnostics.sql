-- ============================================================================
-- PERFORMANCE DIAGNOSTICS
-- Run each block in the Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- Run them ONE BLOCK AT A TIME and copy the results back.
-- Nothing here modifies data — all read-only.
-- ============================================================================


-- ── BLOCK 1: Row counts of the hot tables ──────────────────────────────────
-- Tells us how big the problem actually is. A 500-row leads table is never
-- "slow from the DB"; a 200k-row one with full-scan counts is.
SELECT relname               AS table_name,
       n_live_tup            AS approx_rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM   pg_stat_user_tables
WHERE  relname IN ('leads','activity_logs','messages','voice_calls',
                   'audit_notes','lead_contact_notes','notifications',
                   'project_approvals','profiles')
ORDER  BY n_live_tup DESC;


-- ── BLOCK 2: Which of the perf indexes actually exist? ──────────────────────
-- Confirms whether migration 053 (and the duplicate-lead indexes) were pushed
-- to prod. If rows are MISSING here, applying them is the cheapest fix.
SELECT tablename, indexname
FROM   pg_indexes
WHERE  schemaname = 'public'
  AND  tablename IN ('leads','activity_logs','round_robin_agents',
                     'lead_contact_notes','audit_notes','content_library',
                     'expiry_reminders_sent','email_templates','email_drafts')
ORDER  BY tablename, indexname;


-- ── BLOCK 3: Tables getting hammered by sequential scans ────────────────────
-- High seq_scan with high seq_tup_read on a big table = a missing index or a
-- full-scan query (like COUNT(*) exact). idx_scan shows if indexes are used.
SELECT relname            AS table_name,
       seq_scan,
       seq_tup_read,
       idx_scan,
       n_live_tup         AS approx_rows
FROM   pg_stat_user_tables
WHERE  n_live_tup > 500
ORDER  BY seq_tup_read DESC
LIMIT  15;


-- ── BLOCK 4: Slowest queries (needs pg_stat_statements) ─────────────────────
-- This is the money query — it ranks actual queries by total time spent.
-- If it errors with "relation pg_stat_statements does not exist", run:
--     CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- ...then wait a few minutes of real traffic and run this again.
SELECT round(total_exec_time)::int          AS total_ms,
       calls,
       round(mean_exec_time)::int           AS avg_ms,
       round((100 * total_exec_time /
              sum(total_exec_time) OVER ())::numeric, 1) AS pct_of_total,
       left(query, 200)                      AS query
FROM   pg_stat_statements
WHERE  query NOT ILIKE '%pg_stat_statements%'
ORDER  BY total_exec_time DESC
LIMIT  20;


-- ── BLOCK 6: Live RLS policies on leads (needed to rewrite them safely) ─────
-- Migration history is layered across 011/013/015/067; this shows what is
-- ACTUALLY active on the DB right now. Paste the whole result back.
SELECT policyname, cmd, roles, qual, with_check
FROM   pg_policies
WHERE  schemaname = 'public' AND tablename = 'leads'
ORDER  BY cmd, policyname;


-- ── BLOCK 7: Which tables are published to Realtime? ────────────────────────
-- Every table here generates WAL that Realtime decodes + RLS-checks per
-- subscriber. This is the 54% "wal->>" load. Trimming this list is the fix.
SELECT schemaname, tablename
FROM   pg_publication_tables
WHERE  pubname = 'supabase_realtime'
ORDER  BY tablename;


-- ── BLOCK 5: How slow is ONE leads-page stat count, really? ─────────────────
-- Reproduces exactly what the leads list fires 7× per load. The "Execution
-- Time" at the bottom of the plan is the number that matters.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM leads WHERE status <> 'Live';
