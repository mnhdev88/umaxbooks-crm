-- Team channels: a manager broadcasts to all their sales agents in one thread.
--
-- 059 built the chat 1:1-only, but everything below the UI was already written
-- participant-count agnostic: is_conversation_participant() does not care how
-- many members a conversation has, and on_new_message() already LOOPS over
-- recipients. So a group thread needs no new tables and no RLS changes — it
-- reuses `conversations.is_group` / `.title`, which 059 created and left unused
-- ("reserved for future group threads").
--
-- The only 1:1-specific piece is get_or_create_dm(), which hard-rejects groups.
-- This migration adds its group sibling.
--
-- Membership is DERIVED, never hand-managed: a team channel is anchored to its
-- manager via team_manager_id, and every call re-syncs the roster from
-- profiles.manager_id. A newly hired agent appears in the channel the next time
-- anyone opens it; an agent moved to another manager drops off. Nobody has to
-- remember to maintain it.
--
-- NOTE ON RECEIPTS: 064's ✓✓ ticks are derived from "the OTHER participant's"
-- timestamps, which is meaningless once a thread has 3+ members. The UI hides
-- receipts for groups; acknowledgement is handled by reactions (083) instead.

-- ── conversations: anchor a team channel to its manager ─────────────────────
-- NULL for DMs. UNIQUE (partial) so a manager can never end up with two team
-- channels racing each other.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS team_manager_id UUID
  REFERENCES profiles(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_team_manager_idx
  ON conversations(team_manager_id) WHERE team_manager_id IS NOT NULL;

-- ── get_or_create_team_group: idempotent team channel + roster re-sync ──────
-- Returns the conversation id, creating it on first use. SECURITY DEFINER so
-- callers need no INSERT rights on the chat tables (same reasoning as 059's
-- get_or_create_dm).
--
-- Who may resolve which team:
--   sales_manager → their own team only        (p_manager ignored/must be self)
--   sales_agent   → the team they report to    (resolved from their manager_id)
--   admin         → any manager's team         (p_manager REQUIRED — an admin
--                                               has no team of their own)
--
-- Agents may call it too, deliberately: it means the channel materialises and
-- the roster stays fresh even if the manager hasn't opened it lately.
CREATE OR REPLACE FUNCTION get_or_create_team_group(p_manager UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_role  TEXT := get_my_role();
  v_mgr   UUID;
  v_name  TEXT;
  v_conv  UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- ── Resolve the target team, then authorise it ──
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

  -- The anchor must really be a manager, else the roster query below is
  -- nonsense (it would build an empty channel around a random profile).
  SELECT full_name INTO v_name FROM profiles WHERE id = v_mgr AND role = 'sales_manager';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that user is not a sales manager';
  END IF;

  -- ── Find or create the channel ──
  SELECT id INTO v_conv FROM conversations WHERE team_manager_id = v_mgr;

  IF v_conv IS NULL THEN
    INSERT INTO conversations (is_group, title, created_by, team_manager_id)
    VALUES (TRUE, COALESCE(v_name, 'Team') || '''s Team', v_me, v_mgr)
    RETURNING id INTO v_conv;
  ELSE
    -- Keep the title fresh if the manager was renamed.
    UPDATE conversations
       SET title = COALESCE(v_name, 'Team') || '''s Team'
     WHERE id = v_conv AND title IS DISTINCT FROM COALESCE(v_name, 'Team') || '''s Team';
  END IF;

  -- ── Re-sync the roster: manager + their current sales agents ──
  INSERT INTO conversation_participants (conversation_id, user_id)
  SELECT v_conv, p.id
    FROM profiles p
   WHERE p.id = v_mgr
      OR (p.role = 'sales_agent' AND p.manager_id = v_mgr)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  -- Drop agents who have since moved to another manager. Scoped to
  -- role = 'sales_agent' ON PURPOSE: it must never evict the manager, nor an
  -- admin who joined the thread below.
  DELETE FROM conversation_participants cp
   USING profiles p
   WHERE cp.conversation_id = v_conv
     AND cp.user_id = p.id
     AND p.role = 'sales_agent'
     AND p.manager_id IS DISTINCT FROM v_mgr;

  -- An admin who opens a team channel JOINS it. This is what keeps the whole
  -- feature RLS-free: reads, replies, unread badges and push all key off
  -- participation, so no god-view policies are needed. The trade-off is that
  -- the admin is visible in the member list and is notified of replies —
  -- which is correct, since they can post here.
  IF v_role = 'admin' THEN
    INSERT INTO conversation_participants (conversation_id, user_id)
    VALUES (v_conv, v_me)
    ON CONFLICT (conversation_id, user_id) DO NOTHING;
  END IF;

  RETURN v_conv;
END;
$$;

-- Grants, 081 style: revoking `anon` alone would leave the implicit PUBLIC
-- grant as a back door, so PUBLIC must be revoked too.
REVOKE EXECUTE ON FUNCTION get_or_create_team_group(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_or_create_team_group(UUID) TO authenticated, service_role;
