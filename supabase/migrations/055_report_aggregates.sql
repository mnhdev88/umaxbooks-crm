-- 055_report_aggregates.sql
-- The Reports page used to fetch lead/deal rows and count them in JS, which
-- froze every total at PostgREST's 1000-row cap (and undercounted agent /
-- pipeline / revenue numbers). These functions aggregate in SQL instead, so the
-- counts are exact regardless of table size. SECURITY INVOKER keeps RLS intact
-- (admins see all rows; agents see their own — same as the old direct selects).

-- Lead counts grouped by status + assigned agent. The result set is tiny
-- (statuses × agents), and the page derives every lead KPI from it.
CREATE OR REPLACE FUNCTION report_lead_breakdown(from_ts timestamptz, to_ts timestamptz)
RETURNS TABLE (status text, assigned_agent_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT l.status, l.assigned_agent_id, count(*)::bigint
  FROM leads l
  WHERE (from_ts IS NULL OR l.created_at >= from_ts)
    AND (to_ts   IS NULL OR l.created_at <  to_ts)
  GROUP BY l.status, l.assigned_agent_id
$$;

-- Deal revenue (total + paid) summed in SQL so it isn't capped either.
CREATE OR REPLACE FUNCTION report_deal_revenue(from_ts timestamptz, to_ts timestamptz)
RETURNS TABLE (total_revenue numeric, paid_revenue numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    COALESCE(SUM(d.final_payment_amount), 0)::numeric AS total_revenue,
    COALESCE(SUM(d.final_payment_amount) FILTER (WHERE d.payment_status = 'Paid'), 0)::numeric AS paid_revenue
  FROM deals d
  WHERE (from_ts IS NULL OR d.created_at >= from_ts)
    AND (to_ts   IS NULL OR d.created_at <  to_ts)
$$;

-- Per-user KPI table for the Reports "Agent Performance" / user-kpis section.
-- Same fix: the route previously pulled rows from 5 tables (each capped at 1000)
-- and counted per-user in JS. This aggregates everything server-side in one call.
-- Date semantics mirror the old route exactly:
--   leads_added    — activity_logs 'Lead Created', by created_at
--   leads_assigned — current snapshot, NO date filter
--   leads_completed— leads status='Completed', by updated_at
--   demos_booked   — appointments with a datetime, by created_at
--   deals_closed   — deals payment_status='Paid', by updated_at (revenue summed)
CREATE OR REPLACE FUNCTION report_user_kpis(user_ids uuid[], from_ts timestamptz, to_ts timestamptz)
RETURNS TABLE (
  user_id uuid,
  leads_added bigint,
  leads_assigned bigint,
  leads_completed bigint,
  demos_booked bigint,
  deals_closed bigint,
  revenue numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH u AS (SELECT unnest(user_ids) AS id),
  added AS (
    SELECT al.user_id AS id, count(*)::bigint AS c
    FROM activity_logs al
    WHERE al.user_id = ANY(user_ids) AND al.action = 'Lead Created'
      AND (from_ts IS NULL OR al.created_at >= from_ts)
      AND (to_ts   IS NULL OR al.created_at <  to_ts)
    GROUP BY al.user_id
  ),
  assigned AS (
    SELECT l.assigned_agent_id AS id, count(*)::bigint AS c
    FROM leads l
    WHERE l.assigned_agent_id = ANY(user_ids)
    GROUP BY l.assigned_agent_id
  ),
  completed AS (
    SELECT l.assigned_agent_id AS id, count(*)::bigint AS c
    FROM leads l
    WHERE l.assigned_agent_id = ANY(user_ids) AND l.status = 'Completed'
      AND (from_ts IS NULL OR l.updated_at >= from_ts)
      AND (to_ts   IS NULL OR l.updated_at <  to_ts)
    GROUP BY l.assigned_agent_id
  ),
  demos AS (
    SELECT a.created_by AS id, count(*)::bigint AS c
    FROM appointments a
    WHERE a.created_by = ANY(user_ids) AND a.appointment_datetime IS NOT NULL
      AND (from_ts IS NULL OR a.created_at >= from_ts)
      AND (to_ts   IS NULL OR a.created_at <  to_ts)
    GROUP BY a.created_by
  ),
  dealcnt AS (
    SELECT l.assigned_agent_id AS id,
           count(*)::bigint AS c,
           COALESCE(SUM(d.final_payment_amount), 0)::numeric AS rev
    FROM deals d
    JOIN leads l ON l.id = d.lead_id
    WHERE l.assigned_agent_id = ANY(user_ids) AND d.payment_status = 'Paid'
      AND (from_ts IS NULL OR d.updated_at >= from_ts)
      AND (to_ts   IS NULL OR d.updated_at <  to_ts)
    GROUP BY l.assigned_agent_id
  )
  SELECT
    u.id,
    COALESCE(added.c, 0),
    COALESCE(assigned.c, 0),
    COALESCE(completed.c, 0),
    COALESCE(demos.c, 0),
    COALESCE(dealcnt.c, 0),
    COALESCE(dealcnt.rev, 0)
  FROM u
  LEFT JOIN added     ON added.id     = u.id
  LEFT JOIN assigned  ON assigned.id  = u.id
  LEFT JOIN completed ON completed.id = u.id
  LEFT JOIN demos     ON demos.id     = u.id
  LEFT JOIN dealcnt   ON dealcnt.id   = u.id
$$;

GRANT EXECUTE ON FUNCTION report_lead_breakdown(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION report_deal_revenue(timestamptz, timestamptz)   TO authenticated;
GRANT EXECUTE ON FUNCTION report_user_kpis(uuid[], timestamptz, timestamptz) TO authenticated;
