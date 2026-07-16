-- Let an admin leave a team channel they joined.
--
-- 082 gave admins a way IN (get_or_create_team_group(p_manager) adds them as a
-- participant) but no way OUT, so the only exit was a manual DB delete. That is
-- the gap this closes.
--
-- ── Why only admins can leave ───────────────────────────────────────────────
-- A team channel's roster is DERIVED from profiles.manager_id — it is not a
-- membership list anyone edits. If a manager or an agent could leave, the next
-- get_or_create_team_group() call would simply re-add them (that is the whole
-- point of the re-sync), so "leave" would appear to work and then silently undo
-- itself. Rather than fake it, this rejects them with an explanation.
--
-- Admins are the exception precisely because the re-sync deliberately does NOT
-- manage them: 082's DELETE is scoped to role='sales_agent' so it never evicts
-- an admin. An admin's membership is therefore a real, sticky choice — and so it
-- needs a real way to undo it.
--
-- Note there is no RLS-based alternative here: a member cannot be given DELETE
-- on conversation_participants without also letting them evict OTHER people from
-- any conversation they are in. Hence a SECURITY DEFINER function that can only
-- ever remove the caller's own row.
CREATE OR REPLACE FUNCTION leave_team_channel(p_conversation UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_role   TEXT := get_my_role();
  v_is_team BOOLEAN;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT team_manager_id IS NOT NULL INTO v_is_team
    FROM conversations WHERE id = p_conversation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
  -- Guard the blast radius: this must never be able to dissolve a DM.
  IF NOT v_is_team THEN
    RAISE EXCEPTION 'this is not a team channel';
  END IF;
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'your team channel membership follows your manager — it cannot be left';
  END IF;

  DELETE FROM conversation_participants
   WHERE conversation_id = p_conversation
     AND user_id = v_me;   -- own row only, always
END;
$$;

REVOKE EXECUTE ON FUNCTION leave_team_channel(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION leave_team_channel(UUID) TO authenticated, service_role;
