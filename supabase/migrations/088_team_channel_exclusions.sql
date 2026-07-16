-- Let a manager (or an admin) remove an agent from a team channel.
--
-- ── The problem this has to solve ───────────────────────────────────────────
-- A team channel's roster is DERIVED from profiles.manager_id (082/087). So a
-- plain DELETE from conversation_participants does not remove anyone: the next
-- sync — any profile write, or the agent loading a page — sees they still report
-- to this manager and adds them straight back. The removal silently undoes
-- itself. That is exactly why 086 refuses to let agents "leave".
--
-- So removal needs somewhere durable to record the decision. This table is that
-- record: an explicit exception to the derived roster.
--
--   sync_team_channel adds:  (manager + their agents) MINUS exclusions
--
-- ── Why not just clear manager_id instead ──────────────────────────────────
-- Because manager_id is not a chat setting. It drives lead visibility, the
-- team-activity view, the KPI scorecard and call-performance reporting. Removing
-- someone from a chat must never quietly rewrite who owns their leads. Chat
-- membership and org structure stay separate; this table is the seam.

CREATE TABLE IF NOT EXISTS team_channel_exclusions (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES profiles(id)      ON DELETE CASCADE NOT NULL,
  removed_by      UUID REFERENCES profiles(id)      ON DELETE SET NULL,
  removed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Read-only, and only for the people who can act on it: the channel's own
-- manager, and admins. Ordinary members have no reason to see who was removed.
-- There are deliberately NO INSERT/UPDATE/DELETE policies — every write goes
-- through the SECURITY DEFINER RPCs below, so the authorisation rules live in
-- exactly one place.
ALTER TABLE team_channel_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Channel manager and admins can view exclusions" ON team_channel_exclusions;
CREATE POLICY "Channel manager and admins can view exclusions"
  ON team_channel_exclusions FOR SELECT
  USING (
    (select get_my_role()) = 'admin'
    OR EXISTS (
      SELECT 1 FROM conversations c
       WHERE c.id = conversation_id
         AND c.team_manager_id = (select auth.uid())
    )
  );

-- ── sync_team_channel: now honours exclusions ──────────────────────────────
-- Supersedes 087's copy. Only the roster INSERT changed (the NOT EXISTS clause);
-- everything else is carried over verbatim.
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
    INSERT INTO conversations (is_group, title, created_by, team_manager_id)
    VALUES (TRUE, v_title, p_manager, p_manager)
    RETURNING id INTO v_conv;
  ELSE
    UPDATE conversations SET title = v_title
     WHERE id = v_conv AND title IS DISTINCT FROM v_title;
  END IF;

  -- Roster: manager + their current agents, MINUS anyone explicitly removed.
  -- The manager themselves can never be excluded (enforced in the RPC), so this
  -- can't accidentally produce a headless channel.
  INSERT INTO conversation_participants (conversation_id, user_id)
  SELECT v_conv, p.id
    FROM profiles p
   WHERE (p.id = p_manager OR (p.role = 'sales_agent' AND p.manager_id = p_manager))
     AND NOT EXISTS (
       SELECT 1 FROM team_channel_exclusions e
        WHERE e.conversation_id = v_conv AND e.user_id = p.id
     )
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

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

-- ── Shared authorisation check ──────────────────────────────────────────────
-- Who may manage a team channel's roster: the channel's own manager, or any
-- admin. Raises rather than returning false, so both RPCs fail loudly.
CREATE OR REPLACE FUNCTION assert_can_manage_team_channel(p_conversation UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      UUID := auth.uid();
  v_role    TEXT := get_my_role();
  v_manager UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT team_manager_id INTO v_manager FROM conversations WHERE id = p_conversation;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;
  -- Blast-radius guard: this must never be usable against a DM.
  IF v_manager IS NULL THEN
    RAISE EXCEPTION 'this is not a team channel';
  END IF;

  IF v_role = 'admin' THEN
    RETURN v_manager;
  END IF;
  IF v_role = 'sales_manager' AND v_manager = v_me THEN
    RETURN v_manager;
  END IF;

  RAISE EXCEPTION 'only this team''s manager or an admin can change its members';
END;
$$;

REVOKE EXECUTE ON FUNCTION assert_can_manage_team_channel(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION assert_can_manage_team_channel(UUID) TO authenticated, service_role;

-- ── remove_team_member ──────────────────────────────────────────────────────
-- Records the exclusion, then drops the participant row. Order matters: writing
-- the exclusion first means that even if something re-syncs in between, the
-- agent cannot be re-added.
CREATE OR REPLACE FUNCTION remove_team_member(p_conversation UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me          UUID := auth.uid();
  v_manager     UUID;
  v_target_role TEXT;
BEGIN
  v_manager := assert_can_manage_team_channel(p_conversation);

  -- The channel is anchored to the manager (conversations.team_manager_id).
  -- Removing them would leave a headless team that still bears their name.
  IF p_user = v_manager THEN
    RAISE EXCEPTION 'the manager cannot be removed from their own team channel';
  END IF;

  SELECT role INTO v_target_role FROM profiles WHERE id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Admins are not part of the derived roster — they opt in (082) and out (086)
  -- themselves, and an exclusion row would not hold them out anyway, since the
  -- admin join branch adds them directly.
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'admins manage their own membership — they can use Leave';
  END IF;

  INSERT INTO team_channel_exclusions (conversation_id, user_id, removed_by)
  VALUES (p_conversation, p_user, v_me)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  DELETE FROM conversation_participants
   WHERE conversation_id = p_conversation AND user_id = p_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION remove_team_member(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION remove_team_member(UUID, UUID) TO authenticated, service_role;

-- ── add_team_member: undo a removal ────────────────────────────────────────
-- Clears the exclusion and re-syncs. Deliberately cannot add someone who is not
-- the manager's agent: this restores the derived roster, it does not let anyone
-- hand-pick members into a team channel (that would make the roster a lie).
CREATE OR REPLACE FUNCTION add_team_member(p_conversation UUID, p_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_manager UUID;
BEGIN
  v_manager := assert_can_manage_team_channel(p_conversation);

  IF NOT EXISTS (
    SELECT 1 FROM profiles
     WHERE id = p_user AND role = 'sales_agent' AND manager_id = v_manager
  ) THEN
    RAISE EXCEPTION 'only this manager''s own agents can be added back';
  END IF;

  DELETE FROM team_channel_exclusions
   WHERE conversation_id = p_conversation AND user_id = p_user;

  PERFORM sync_team_channel(v_manager);
END;
$$;

REVOKE EXECUTE ON FUNCTION add_team_member(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION add_team_member(UUID, UUID) TO authenticated, service_role;

-- ── Trigger: leaving a team clears your exclusion from it ──────────────────
-- Supersedes 087's copy. Without this, an agent removed from Mark's channel,
-- moved to another manager, then moved back to Mark would silently stay out of
-- chat because of a months-old removal nobody remembers. Leaving a team wipes
-- the slate; coming back is a fresh start.
CREATE OR REPLACE FUNCTION on_profile_team_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Best-effort: an admin saving a user must NEVER fail because of chat.
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.manager_id IS DISTINCT FROM NEW.manager_id AND OLD.manager_id IS NOT NULL THEN
      DELETE FROM team_channel_exclusions e
       USING conversations c
       WHERE e.conversation_id = c.id
         AND c.team_manager_id = OLD.manager_id
         AND e.user_id = NEW.id;
    END IF;

    IF NEW.role = 'sales_manager' THEN
      PERFORM sync_team_channel(NEW.id);
    END IF;

    IF NEW.role = 'sales_agent' AND NEW.manager_id IS NOT NULL THEN
      PERFORM sync_team_channel(NEW.manager_id);
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.manager_id IS NOT NULL AND OLD.manager_id IS DISTINCT FROM NEW.manager_id THEN
        PERFORM sync_team_channel(OLD.manager_id);
      END IF;

      -- Stopped being an agent at all (promoted to manager, made an admin, …).
      -- sync_team_channel's cleanup only matches role='sales_agent', so it is
      -- blind to someone who just left that role and would leave them sitting in
      -- their old team's channel, still receiving its messages.
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
