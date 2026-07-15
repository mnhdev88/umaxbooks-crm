-- 1. Harden SECURITY DEFINER functions exposed over /rest/v1/rpc.
--
-- Each of these carried an explicit `anon` grant AND a PUBLIC grant (ACL
-- `=X/postgres`), so revoking anon alone leaves PUBLIC as a back door — both
-- have to go. service_role/authenticated are re-granted explicitly afterwards
-- rather than relying on the PUBLIC grant they used to inherit.

-- Deletes rows from auth.users. app/api/admin/delete-user already gates on
-- role='admin' and calls this with the service-role key; the hole was that the
-- RPC was reachable directly with the anon key, skipping that check entirely.
-- A DB-side admin check is not possible here: service_role has no profiles row,
-- so get_my_role() returns NULL for the only caller that should succeed.
REVOKE EXECUTE ON FUNCTION public.reassign_and_delete_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reassign_and_delete_user(uuid, uuid) TO service_role;

-- auto_assign_lead is SECURITY INVOKER and calls this from its body, so the
-- inserting agent's own role needs EXECUTE — revoking it from authenticated
-- would break Add Lead.
REVOKE EXECUTE ON FUNCTION public.pick_round_robin_agent(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pick_round_robin_agent(uuid) TO authenticated, service_role;

-- Trigger-only. Postgres checks EXECUTE at CREATE TRIGGER time, not at fire
-- time, so no caller role needs a grant for the triggers to keep firing.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_push_notification() FROM PUBLIC, anon, authenticated;

-- Signed-in-only chat/presence helpers. Harmless for anon today (they key off
-- auth.uid()), but there is no reason for them to answer an unauthenticated call.
REVOKE EXECUTE ON FUNCTION public.get_or_create_dm(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_dm(uuid)  TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mark_all_delivered()    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_all_delivered()    TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mark_delivered(uuid)    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mark_delivered(uuid)    TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.chat_unread_count()     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.chat_unread_count()     TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen()       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.touch_last_seen()       TO authenticated, service_role;

-- get_my_role / my_managed_agent_ids / manages_agent / is_conversation_participant
-- are deliberately left alone: RLS policy expressions call them, and the
-- executing role needs EXECUTE for those policies to evaluate. They return NULL
-- or empty for anon, so exposure is nil.

-- 2. Collapse the six per-tab lead counts into a single scan.
--
-- app/(dashboard)/leads/page.tsx fired six independent count(*) head requests
-- (countBase()), each one re-planning and re-scanning leads under RLS: 449
-- shared buffers and ~30 get_my_role() evaluations per page load. Conditional
-- aggregation does the same work in one pass over 163 buffers.
--
-- SECURITY INVOKER (the default, stated for intent): the caller's RLS on leads
-- still applies, so this widens nothing. The developer narrowing and the
-- Reports drill-down mirror applyBase() in that page.
CREATE OR REPLACE FUNCTION public.leads_tab_counts(
  p_agent uuid        DEFAULT NULL,
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total  bigint,
  new_ct bigint,
  gmb    bigint,
  demo   bigint,
  closed bigint,
  social bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE l.status = 'New'),
    count(*) FILTER (WHERE l.source = 'GMB'),
    count(*) FILTER (WHERE l.status = 'Demo Scheduled'),
    count(*) FILTER (WHERE l.status = 'Closed Won'),
    count(*) FILTER (WHERE l.source IN ('Facebook', 'LinkedIn'))
  FROM public.leads l
  WHERE l.status <> 'Live'
    -- IS DISTINCT FROM, not <>: a NULL role must not silently narrow to Contacted.
    AND ((SELECT public.get_my_role()) IS DISTINCT FROM 'developer' OR l.status = 'Contacted')
    AND (p_agent IS NULL OR l.created_by  = p_agent)
    AND (p_from  IS NULL OR l.created_at >= p_from)
    AND (p_to    IS NULL OR l.created_at <  p_to);
$$;

REVOKE EXECUTE ON FUNCTION public.leads_tab_counts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.leads_tab_counts(uuid, timestamptz, timestamptz) TO authenticated, service_role;
