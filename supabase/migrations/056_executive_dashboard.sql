-- 056_executive_dashboard.sql
-- Single RPC powering the executive Dashboard page. Everything is aggregated in
-- SQL and returned as one JSON object, so the page makes ONE round-trip and is
-- never exposed to PostgREST's 1000-row select cap (which silently froze every
-- count-in-JS total in the past — see report_lead_breakdown / 055).
--
-- SECURITY INVOKER keeps RLS intact: admins see all rows, agents see their own,
-- so the same function safely scopes numbers to whoever calls it.
--
-- Date semantics: every section is filtered by its own created_at within
-- [from_ts, to_ts) EXCEPT follow-up "overdue", which is a live snapshot vs now().

CREATE OR REPLACE FUNCTION report_executive_summary(from_ts timestamptz, to_ts timestamptz)
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT json_build_object(
    -- Pipeline: {status -> count} over leads created in range
    'leads_by_status', (
      SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
      FROM (
        SELECT l.status, count(*)::bigint AS cnt
        FROM leads l
        WHERE (from_ts IS NULL OR l.created_at >= from_ts)
          AND (to_ts   IS NULL OR l.created_at <  to_ts)
        GROUP BY l.status
      ) s
    ),

    -- Deals: revenue totals + payment-status breakdown
    'deals', (
      SELECT json_build_object(
        'total_revenue', COALESCE(SUM(d.final_payment_amount), 0),
        'paid_revenue',  COALESCE(SUM(d.final_payment_amount) FILTER (WHERE d.payment_status = 'Paid'), 0),
        'count',         count(*),
        'by_status', (
          SELECT COALESCE(json_object_agg(payment_status, cnt), '{}'::json)
          FROM (
            SELECT d2.payment_status, count(*)::bigint AS cnt
            FROM deals d2
            WHERE (from_ts IS NULL OR d2.created_at >= from_ts)
              AND (to_ts   IS NULL OR d2.created_at <  to_ts)
            GROUP BY d2.payment_status
          ) ds
        )
      )
      FROM deals d
      WHERE (from_ts IS NULL OR d.created_at >= from_ts)
        AND (to_ts   IS NULL OR d.created_at <  to_ts)
    ),

    -- Demos: appointments booked (have a datetime) within range
    'demos_booked', (
      SELECT count(*)::bigint
      FROM appointments a
      WHERE a.appointment_datetime IS NOT NULL
        AND (from_ts IS NULL OR a.created_at >= from_ts)
        AND (to_ts   IS NULL OR a.created_at <  to_ts)
    ),

    -- Contracts: {sent|signed|cancelled -> count} within range
    'contracts_by_status', (
      SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
      FROM (
        SELECT c.status, count(*)::bigint AS cnt
        FROM contracts c
        WHERE (from_ts IS NULL OR c.created_at >= from_ts)
          AND (to_ts   IS NULL OR c.created_at <  to_ts)
        GROUP BY c.status
      ) cs
    ),

    -- Calls (AI + dialer): volume and outcomes within range
    'calls', (
      SELECT json_build_object(
        'total',              count(*),
        'completed',          count(*) FILTER (WHERE v.completed IS TRUE OR v.status = 'completed'),
        'interested_yes',     count(*) FILTER (WHERE v.interested = 'yes'),
        'interested_maybe',   count(*) FILTER (WHERE v.interested = 'maybe'),
        'interested_no',      count(*) FILTER (WHERE v.interested = 'no'),
        'appointment_booked', count(*) FILTER (WHERE v.appointment_booked IS TRUE),
        'do_not_call',        count(*) FILTER (WHERE v.do_not_call IS TRUE)
      )
      FROM voice_calls v
      WHERE (from_ts IS NULL OR v.created_at >= from_ts)
        AND (to_ts   IS NULL OR v.created_at <  to_ts)
    ),

    -- Emails: {sent|delivered|bounced|... -> count} within range
    'emails_by_status', (
      SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
      FROM (
        SELECT e.status, count(*)::bigint AS cnt
        FROM email_sends e
        WHERE (from_ts IS NULL OR e.created_at >= from_ts)
          AND (to_ts   IS NULL OR e.created_at <  to_ts)
        GROUP BY e.status
      ) es
    ),

    -- Support: {open|in_progress|resolved -> count} within range
    'support_by_status', (
      SELECT COALESCE(json_object_agg(status, cnt), '{}'::json)
      FROM (
        SELECT sr.status, count(*)::bigint AS cnt
        FROM support_requests sr
        WHERE (from_ts IS NULL OR sr.created_at >= from_ts)
          AND (to_ts   IS NULL OR sr.created_at <  to_ts)
        GROUP BY sr.status
      ) ss
    ),

    -- Follow-ups: live snapshot — pending total + overdue (past due, still pending)
    'followups', (
      SELECT json_build_object(
        'pending', count(*) FILTER (WHERE f.status = 'pending'),
        'overdue', count(*) FILTER (WHERE f.status = 'pending' AND f.scheduled_at < now())
      )
      FROM follow_ups f
    )
  );
$$;

GRANT EXECUTE ON FUNCTION report_executive_summary(timestamptz, timestamptz) TO authenticated;
