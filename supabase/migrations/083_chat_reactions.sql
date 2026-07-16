-- Emoji reactions on chat messages.
--
-- This is NOT decoration — it is the replacement for a feature that breaks in
-- groups. 064's ✓✓ receipts are defined as "derived from the OTHER
-- participant's timestamps", which has no meaning once a thread has 3+ members
-- (082). Slack solved the same problem the same way: a manager posts "meeting
-- at 4pm", agents react 👍, and THAT is the acknowledgement. So groups trade
-- ticks for reactions; DMs keep both.
--
-- No trigger here on purpose: a reaction must never generate a notification or
-- a web push. Reacting is the cheap, quiet acknowledgement — if it pinged the
-- sender's phone it would defeat the point.

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID REFERENCES messages(id)  ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES profiles(id)  ON DELETE CASCADE NOT NULL,
  emoji      TEXT NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per person per emoji per message: reacting twice with the same
  -- emoji is a no-op, and toggling off is a DELETE of exactly this key.
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON message_reactions(message_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Visibility follows the message: if you can read the message you can see its
-- reactions. Reached via the same is_conversation_participant() helper
-- everything else keys off, so groups and DMs need no separate rules.
-- auth.uid() is wrapped in (select ...) per 079 so PG evaluates it once per
-- query (InitPlan) instead of once per row.
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view reactions" ON message_reactions;
CREATE POLICY "Participants can view reactions"
  ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM messages m
     WHERE m.id = message_id
       AND is_conversation_participant(m.conversation_id, (select auth.uid()))
  ));

-- React only as yourself, and only on messages you can actually see.
DROP POLICY IF EXISTS "Participants can add their own reactions" ON message_reactions;
CREATE POLICY "Participants can add their own reactions"
  ON message_reactions FOR INSERT
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM messages m
       WHERE m.id = message_id
         AND is_conversation_participant(m.conversation_id, (select auth.uid()))
    )
  );

-- Un-react: your own rows only. No membership re-check — someone removed from a
-- team channel (082 re-sync) should still be able to withdraw their own
-- reaction rather than leave it stranded.
DROP POLICY IF EXISTS "Users can remove their own reactions" ON message_reactions;
CREATE POLICY "Users can remove their own reactions"
  ON message_reactions FOR DELETE
  USING (user_id = (select auth.uid()));

-- ── Realtime ────────────────────────────────────────────────────────────────
-- REPLICA IDENTITY FULL so DELETE events carry the old row (same reasoning as
-- 063): without it the payload is just the PK and the client cannot tell which
-- reaction vanished from which message.
ALTER TABLE message_reactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already published; re-runnable
END $$;
