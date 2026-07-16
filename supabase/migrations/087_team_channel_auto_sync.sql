-- Create/sync a team channel the moment a manager or agent is ASSIGNED,
-- rather than lazily when someone next loads a page.
--
-- 082 materialised the channel on page load (the widget and /messages call
-- get_or_create_team_group on mount). That works, but it means a brand-new
-- manager has no channel until they log in, and an agent assigned to a manager
-- doesn't join until they happen to open the app — so they'd miss messages sent
-- in between. Assignment is the real event; this hangs the work off that.
--
-- ── Why a trigger and not the API routes ────────────────────────────────────
-- Roles are set in at least two places (admin/create-user and admin/update-user)
-- and can also change from a SQL console or a future import script. A trigger
-- catches every path exactly once. Page-load sync stays as a self-healing
-- backstop — both call the same function, and it is idempotent.
--
-- ── Structure ───────────────────────────────────────────────────────────────
-- The work is split out of get_or_create_team_group into sync_team_channel():
-- the trigger cannot use the RPC, because the RPC authorises against auth.uid()
-- and the actor here is the ADMIN doing the assignment, not the manager. So:
--
--   sync_team_channel(manager)      → does the work, no auth. Trigger + RPC.
--   get_or_create_team_group(mgr)   → authorises the caller, then delegates.
--
-- sync_team_channel is intentionally NOT granted to authenticated: calling it
-- directly would let any user materialise any manager's channel.

-- ── The worker ──────────────────────────────────────────────────────────────
-- Returns the conversation id, or NULL if p_manager is not (or is no longer) a
-- sales manager. NULL rather than an exception because the trigger calls this
-- speculatively on every profile write.
--
-- A DEMOTED manager returns NULL: their channel and its history are left alone,
-- but the roster stops updating. Nothing is destroyed by editing a role.
CREATE OR REPLACE FUNCTION sync_team_channel(p_manager UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name  TEXT;
  v_title TEXT;
  v_conv  UUID;
BEGIN
  IF p_manager IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT full_name INTO v_name FROM profiles WHERE id = p_manager AND role = 'sales_manager';
  IF NOT FOUND THEN
    RETURN NULL;   -- not a manager, or demoted → never create, never sync
  END IF;

  v_title := COALESCE(v_name, 'Team') || '''s Team';

  SELECT id INTO v_conv FROM conversations WHERE team_manager_id = p_manager;

  IF v_conv IS NULL THEN
    -- created_by is the MANAGER, not whoever triggered this. The channel is
    -- theirs regardless of which admin happened to press save.
    INSERT INTO conversations (is_group, title, created_by, team_manager_id)
    VALUES (TRUE, v_title, p_manager, p_manager)
    RETURNING id INTO v_conv;
  ELSE
    -- Keep the title fresh if the manager was renamed.
    UPDATE conversations SET title = v_title
     WHERE id = v_conv AND title IS DISTINCT FROM v_title;
  END IF;

  -- Roster: manager + their current sales agents.
  INSERT INTO conversation_participants (conversation_id, user_id)
  SELECT v_conv, p.id
    FROM profiles p
   WHERE p.id = p_manager
      OR (p.role = 'sales_agent' AND p.manager_id = p_manager)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Drop agents who moved to another manager. Scoped to role='sales_agent' so it
  -- never evicts the manager, nor an admin who opted in (082/086). Someone who
  -- has LEFT the sales_agent role entirely is handled by the trigger below —
  -- this clause cannot see them, because they no longer match role='sales_agent'.
  DELETE FROM conversation_participants cp
   USING profiles p
   WHERE cp.conversation_id = v_conv
     AND cp.user_id = p.id
     AND p.role = 'sales_agent'
     AND p.manager_id IS DISTINCT FROM p_manager;

  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_team_channel(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_team_channel(UUID) TO service_role;

-- ── The RPC now authorises, then delegates ──────────────────────────────────
-- Supersedes 082's copy. The authorisation rules are unchanged; only the body
-- after them moved into sync_team_channel().
CREATE OR REPLACE FUNCTION get_or_create_team_group(p_manager UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   UUID := auth.uid();
  v_role TEXT := get_my_role();
  v_mgr  UUID;
  v_conv UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF v_role = 'sales_manager' THEN
    v_mgr := v_me;
    IF p_manager IS NOT NULL AND p_manager <> v_me THEN
      RAISE EXCEPTION 'you can only open your own team channel';
    END IF;

  ELSIF v_role = 'sales_agent' THEN
    SELECT manager_id INTO v_mgr FROM profiles WHERE id = v_me;
    IF v_mgr IS NULL THEN
      RAISE EXCEPTION 'you are not assigned to a sales manager';
    END IF;
    IF p_manager IS NOT NULL AND p_manager <> v_mgr THEN
      RAISE EXCEPTION 'you can only open your own team channel';
    END IF;

  ELSIF v_role = 'admin' THEN
    IF p_manager IS NULL THEN
      RAISE EXCEPTION 'admins must specify which manager''s team to open';
    END IF;
    v_mgr := p_manager;

  ELSE
    RAISE EXCEPTION 'team channels are for sales staff';
  END IF;

  v_conv := sync_team_channel(v_mgr);
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'that user is not a sales manager';
  END IF;

  -- An admin who opens a team channel JOINS it (086 gives them a way out).
  IF v_role = 'admin' THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv, v_me)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_or_create_team_group(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_or_create_team_group(UUID) TO authenticated, service_role;

-- ── The trigger ─────────────────────────────────────────────────────────────
-- Fires on the three columns that can change a team's shape:
--   role        — someone becomes (or stops being) a manager or an agent
--   manager_id  — an agent joins, moves, or is unassigned
--   full_name   — the channel title is derived from it
CREATE OR REPLACE FUNCTION on_profile_team_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Best-effort: an admin saving a user must NEVER fail because of chat.
  BEGIN
    -- Became / still is a manager → ensure the channel exists and is titled right.
    IF NEW.role = 'sales_manager' THEN
      PERFORM sync_team_channel(NEW.id);
    END IF;

    -- Is an agent with a manager → ensure they are in that manager's channel.
    IF NEW.role = 'sales_agent' AND NEW.manager_id IS NOT NULL THEN
      PERFORM sync_team_channel(NEW.manager_id);
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Left a manager (moved or unassigned) → re-sync the OLD team so they
      -- drop off it.
      IF OLD.manager_id IS NOT NULL AND OLD.manager_id IS DISTINCT FROM NEW.manager_id THEN
        PERFORM sync_team_channel(OLD.manager_id);
      END IF;

      -- Stopped being an agent at all (promoted to manager, made an admin, …).
      -- This needs its own DELETE: sync_team_channel's cleanup only matches
      -- role='sales_agent', so it is blind to someone who just left that role
      -- and would leave them sitting in their old team's channel, still
      -- receiving its messages.
      IF OLD.role = 'sales_agent' AND NEW.role <> 'sales_agent' AND OLD.manager_id IS NOT NULL THEN
        DELETE FROM conversation_participants cp
         USING conversations c
         WHERE cp.conversation_id = c.id
           AND c.team_manager_id = OLD.manager_id
           AND cp.user_id = NEW.id;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- chat sync must never block a profile write
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_team_channel_sync ON profiles;
CREATE TRIGGER profiles_team_channel_sync
  AFTER INSERT OR UPDATE OF role, manager_id, full_name ON profiles
  FOR EACH ROW EXECUTE FUNCTION on_profile_team_change();
