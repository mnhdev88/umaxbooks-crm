-- @mentions in chat.
--
-- In a team channel (082) every message already notifies every member, which is
-- right for a manager's broadcast but leaves no way to say "Priya, this one is
-- for you". A mention raises the signal: the mentioned member gets a distinct
-- notification and push ("X mentioned you in Y") instead of the generic preview.
--
-- WHY AN ARRAY, NOT TEXT PARSING: names contain spaces ("David Parker"), so
-- scraping "@..." out of the body is ambiguous and would break on nicknames or
-- an email address in the text. The composer knows exactly who was picked from
-- the autocomplete, so it sends the ids explicitly. The body keeps the pretty
-- "@David Parker" text purely for display.

-- ── messages: who was mentioned ─────────────────────────────────────────────
-- Capped at 50 so a malformed client cannot fan out an unbounded notification
-- storm from one INSERT.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_mentions_len_check;
ALTER TABLE messages ADD CONSTRAINT messages_mentions_len_check
  CHECK (array_length(mentions, 1) IS NULL OR array_length(mentions, 1) <= 50);

-- ── on_new_message: mention-aware notifications ─────────────────────────────
-- Rewritten from the live 060 version (which added the attachment-aware preview
-- that 059 lacked — preserved below). Two changes only:
--
--   1. A mentioned recipient gets type='warning' + "X mentioned you in Y".
--   2. The unread-collapse now deletes ONLY type='info' rows. Previously any new
--      message in a thread wiped the recipient's prior unread ping for that
--      thread; that must not silently swallow a mention. If Priya is mentioned
--      and six "ok"s follow, her mention ping survives.
--
-- Mentions are intersected with the participant list on purpose: a crafted
-- client cannot mention a non-member to ping someone outside the conversation.
CREATE OR REPLACE FUNCTION on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name TEXT;
  v_link        TEXT := '/messages?c=' || NEW.conversation_id;
  v_preview     TEXT := COALESCE(NULLIF(left(NEW.body, 140), ''), '📎 ' || COALESCE(NEW.attachment_name, 'Attachment'));
  v_title       TEXT;
  v_mentioned   BOOLEAN;
  r_user        UUID;
BEGIN
  -- Critical: keep conversation ordering fresh.
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;

  -- Best-effort: notifying recipients must NEVER block the chat message, so any
  -- failure in this block (notifications schema drift, push, etc.) is swallowed.
  BEGIN
    SELECT full_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;
    SELECT title INTO v_title FROM conversations WHERE id = NEW.conversation_id;

    FOR r_user IN
      SELECT user_id FROM conversation_participants
      WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
    LOOP
      v_mentioned := r_user = ANY (NEW.mentions);

      -- Collapse prior UNREAD generic pings for this thread so the bell shows
      -- one per conversation. Scoped to type='info' so mention pings survive.
      DELETE FROM notifications
        WHERE user_id = r_user AND read = FALSE AND link = v_link AND type = 'info';

      IF v_mentioned THEN
        INSERT INTO notifications (user_id, title, message, type, link)
          VALUES (
            r_user,
            COALESCE(v_sender_name, 'Someone') || ' mentioned you'
              || COALESCE(' in ' || v_title, ''),
            v_preview, 'warning', v_link
          );
      ELSE
        INSERT INTO notifications (user_id, title, message, type, link)
          VALUES (r_user, COALESCE(v_sender_name, 'New message'), v_preview, 'info', v_link);
      END IF;
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
