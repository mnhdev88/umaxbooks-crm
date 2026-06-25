-- Fully remove Eva & Anna from the CRM (hard delete), reassigning their work to Mark.
--
-- Migration 065 already moved their *leads* to Mark Hill and pulled them from the
-- round-robin pool, but kept their profile rows "for history". This finishes the job.
--
-- The hard part is that ~20 tables reference profiles(id), several as NOT NULL with
-- no cascade (audits/appointments/revisions.created_by, activity_logs.user_id,
-- follow_up_steps.created_by, lead_contact_notes/audit_notes.user_id, contracts...),
-- so deleting a profile fails with a foreign-key violation. Rather than hand-list
-- every column (and miss one — as earlier attempts did), this installs a reusable
-- function that DISCOVERS every restrict/no-action FK to profiles from the catalog
-- and re-homes it onto the heir, then deletes the account. ON DELETE CASCADE /
-- SET NULL references (notifications, follow_ups, round_robin_agents, push subs,
-- chat) are left alone — the delete handles them per their declared behaviour.
--
-- The same function backs the admin "delete user" button (app/api/admin/delete-user).

CREATE OR REPLACE FUNCTION reassign_and_delete_user(p_target UUID, p_heir UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF p_target IS NULL THEN
    RETURN;                       -- already gone; nothing to do
  END IF;
  IF p_heir IS NULL THEN
    RAISE EXCEPTION 'reassign_and_delete_user: heir is NULL — refusing to orphan records';
  END IF;
  IF p_heir = p_target THEN
    RAISE EXCEPTION 'reassign_and_delete_user: heir and target are the same user';
  END IF;

  -- Re-home every single-column restrict/no-action FK that points at profiles(id).
  FOR r IN
    SELECT rel.relname AS child_table,
           att.attname AS child_col
    FROM   pg_constraint con
    JOIN   pg_class     rel ON rel.oid = con.conrelid
    JOIN   pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE  con.contype   = 'f'
      AND  con.confrelid = 'public.profiles'::regclass
      AND  con.confdeltype IN ('a', 'r')          -- a = NO ACTION, r = RESTRICT
      AND  array_length(con.conkey, 1) = 1        -- single-column FKs only
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE %I = $2',
                   r.child_table, r.child_col, r.child_col)
    USING p_heir, p_target;
  END LOOP;

  -- Delete the auth account. Cascades to profiles (FK ON DELETE CASCADE) and to all
  -- cascade-linked children (notifications, follow_ups, round_robin_agents rows,
  -- push subscriptions, chat participation & messages they sent).
  DELETE FROM auth.users WHERE id = p_target;
END $$;

-- The admin delete-user route calls this via PostgREST RPC with the service role.
GRANT EXECUTE ON FUNCTION reassign_and_delete_user(UUID, UUID) TO service_role;

-- ── Apply it to Eva & Anna, with Mark Hill as the heir ──────────────────────────
DO $$
DECLARE
  eva_id  UUID;
  anna_id UUID;
  mark_id UUID;
BEGIN
  SELECT id INTO eva_id  FROM profiles WHERE email = 'eva@noveliotech.com';
  SELECT id INTO anna_id FROM profiles WHERE email = 'anna@noveliotech.com';
  SELECT id INTO mark_id FROM profiles WHERE lower(full_name) = lower('Mark Hill');

  IF eva_id IS NULL AND anna_id IS NULL THEN
    RAISE NOTICE 'Eva and Anna not found — nothing to delete';
    RETURN;
  END IF;

  IF mark_id IS NULL THEN
    RAISE EXCEPTION 'Mark Hill profile not found — aborting deletion';
  END IF;

  PERFORM reassign_and_delete_user(eva_id,  mark_id);
  PERFORM reassign_and_delete_user(anna_id, mark_id);
  RAISE NOTICE 'Removed Eva & Anna; their authored records moved to Mark Hill';
END $$;
