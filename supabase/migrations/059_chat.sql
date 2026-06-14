-- Internal staff chat (1:1 direct messages).
--
-- Three tables on top of Supabase Realtime — no new infra. The open chat
-- window subscribes to postgres_changes on `messages` (same pattern as the
-- notifications page). Offline delivery is FREE: the messages trigger inserts
-- a `notifications` row per recipient, which fires the existing 058 web-push
-- dispatch trigger. Chat pings collapse to one unread notification per
-- conversation so the bell stays clean.
--
-- Clients (role = 'client') are excluded — this is staff-only DMs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  is_group        BOOLEAN     NOT NULL DEFAULT FALSE,  -- reserved for future group threads
  title           TEXT,                                -- group name; NULL for 1:1 DMs
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- drives conversation-list ordering
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id         UUID REFERENCES profiles(id)      ON DELETE CASCADE NOT NULL,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- everything before this is "read"
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id       UUID REFERENCES profiles(id)      ON DELETE CASCADE NOT NULL,
  body            TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx     ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS participants_user_idx          ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS conversations_last_message_idx ON conversations(last_message_at DESC);

-- ── Membership helper (SECURITY DEFINER → bypasses RLS, avoids recursion) ─────
-- Both the participants SELECT policy and the messages policies key off this.
-- Defining it SECURITY DEFINER is what stops the participants policy from
-- recursing into itself.
CREATE OR REPLACE FUNCTION is_conversation_participant(p_conversation UUID, p_user UUID)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation AND user_id = p_user
  )
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;

-- conversations: visible only to participants. Creation goes through the
-- get_or_create_dm() RPC (SECURITY DEFINER), so no INSERT policy is needed.
CREATE POLICY "Participants can view their conversations"
  ON conversations FOR SELECT
  USING (is_conversation_participant(id, auth.uid()));

-- participants: a member can see the membership rows of conversations they're in.
CREATE POLICY "Participants can view conversation membership"
  ON conversation_participants FOR SELECT
  USING (is_conversation_participant(conversation_id, auth.uid()));

-- participants: a member can update only their OWN row (to bump last_read_at).
CREATE POLICY "Members can update their own read state"
  ON conversation_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- messages: read if you're in the conversation.
CREATE POLICY "Participants can read messages"
  ON messages FOR SELECT
  USING (is_conversation_participant(conversation_id, auth.uid()));

-- messages: send only as yourself, only into conversations you belong to.
CREATE POLICY "Participants can send messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(conversation_id, auth.uid())
  );

-- ── get_or_create_dm: idempotent 1:1 thread between two staff users ──────────
-- Returns the conversation id. Creates it (plus both participant rows) on first
-- use. SECURITY DEFINER so callers don't need INSERT rights on the chat tables.
CREATE OR REPLACE FUNCTION get_or_create_dm(p_other UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    UUID := auth.uid();
  v_conv  UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_other = v_me THEN
    RAISE EXCEPTION 'cannot start a conversation with yourself';
  END IF;

  -- Staff-only: neither side may be a client.
  IF EXISTS (SELECT 1 FROM profiles WHERE id IN (v_me, p_other) AND role = 'client') THEN
    RAISE EXCEPTION 'chat is staff-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_other) THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  -- Existing non-group DM that contains exactly these two users.
  SELECT c.id INTO v_conv
  FROM conversations c
  WHERE c.is_group = FALSE
    AND (SELECT count(*) FROM conversation_participants p WHERE p.conversation_id = c.id) = 2
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.user_id = v_me)
    AND EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.user_id = p_other)
  LIMIT 1;

  IF v_conv IS NOT NULL THEN
    RETURN v_conv;
  END IF;

  INSERT INTO conversations (is_group, created_by) VALUES (FALSE, v_me) RETURNING id INTO v_conv;
  INSERT INTO conversation_participants (conversation_id, user_id) VALUES (v_conv, v_me), (v_conv, p_other);
  RETURN v_conv;
END;
$$;

-- ── chat_unread_count: number of conversations with unread messages ─────────
-- Backs the sidebar "Messages" badge. SECURITY DEFINER to read across the
-- caller's conversations without RLS gymnastics.
CREATE OR REPLACE FUNCTION chat_unread_count()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT count(DISTINCT m.conversation_id)::int
  FROM messages m
  JOIN conversation_participants p
    ON p.conversation_id = m.conversation_id AND p.user_id = auth.uid()
  WHERE m.sender_id <> auth.uid()
    AND m.created_at > p.last_read_at
$$;

-- ── Trigger: on new message → bump conversation + notify recipients ─────────
-- The notification insert reuses the 058 push-dispatch trigger, so recipients
-- get a web-push for free. Prior UNREAD chat notifications for the same
-- conversation are collapsed first so the bell shows one ping per thread.
CREATE OR REPLACE FUNCTION on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name TEXT;
  v_link        TEXT := '/messages?c=' || NEW.conversation_id;
  v_preview     TEXT := left(NEW.body, 140);
  r_user        UUID;
BEGIN
  -- Critical: keep conversation ordering fresh.
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;

  -- Best-effort: notifying recipients must NEVER block the chat message, so any
  -- failure in this block (notifications schema drift, push, etc.) is swallowed.
  BEGIN
    SELECT full_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;

    FOR r_user IN
      SELECT user_id FROM conversation_participants
      WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
    LOOP
      DELETE FROM notifications
        WHERE user_id = r_user AND read = FALSE AND link = v_link;
      INSERT INTO notifications (user_id, title, message, type, link)
        VALUES (r_user, COALESCE(v_sender_name, 'New message'), v_preview, 'info', v_link);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- notification failure must never fail the chat message
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_after_insert ON messages;
CREATE TRIGGER messages_after_insert
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION on_new_message();

-- ── Realtime ────────────────────────────────────────────────────────────────
-- postgres_changes only fires for tables in the supabase_realtime publication.
-- RLS still applies to the realtime stream, so members only receive their own
-- conversations' messages. Guarded so re-running the migration is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE conversations IS 'Staff chat threads (1:1 DMs; is_group reserved for future group chat).';
COMMENT ON TABLE messages      IS 'Chat messages. INSERT trigger notifies recipients (→ web push via 058).';
