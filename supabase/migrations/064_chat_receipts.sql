-- WhatsApp-style delivery/read receipts for chat (1:1 DMs).
--
-- Three states, all derived from the OTHER participant's timestamps:
--   sent      → the message row exists
--   delivered → other.delivered_at >= message.created_at   (reached their device)
--   seen      → other.last_read_at >= message.created_at   (they opened the chat)
--
-- last_read_at already exists (drives unread). This adds delivered_at plus the
-- realtime plumbing so the sender's ticks update live.

ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Recipient marks a single conversation delivered (on receiving a message).
CREATE OR REPLACE FUNCTION mark_delivered(p_conversation UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE conversation_participants
  SET delivered_at = NOW()
  WHERE conversation_id = p_conversation AND user_id = auth.uid();
$$;

-- Recipient marks all their conversations delivered (on app load — clears the
-- backlog of messages sent while they were offline).
CREATE OR REPLACE FUNCTION mark_all_delivered()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE conversation_participants
  SET delivered_at = NOW()
  WHERE user_id = auth.uid();
$$;

-- Stream participant read/delivered updates so the sender's ticks change live.
-- (default replica identity = PK is enough: UPDATE delivers the new row and the
-- conversation_id filter keys off the PK.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_participants'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
    END IF;
  END IF;
END $$;
