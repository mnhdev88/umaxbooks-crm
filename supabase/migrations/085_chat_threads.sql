-- Threaded replies (Slack-style) for chat.
--
-- A reply hangs off a parent message instead of landing in the main channel
-- flow. The channel view renders only top-level messages (parent_message_id IS
-- NULL) plus a "N replies" affordance; the replies live in a thread pane.
--
-- ── The notification rule is the whole point ────────────────────────────────
-- A channel message notifies EVERY member (082: that is what makes a manager's
-- broadcast work). A thread reply must NOT — otherwise a side discussion between
-- two agents pushes a phone notification to the other four, and threads would
-- make the channel noisier rather than quieter, which is backwards.
--
-- So a reply notifies only: the parent's author, anyone already replying in that
-- thread, and anyone @mentioned (084 — a mention always gets through). The
-- notification link carries &t=<parent> so the bell opens the thread itself.
--
-- ── Depth is capped at one ──────────────────────────────────────────────────
-- Replies to replies are rejected. Slack works this way and it is not a
-- limitation but the reason threads stay readable: arbitrary nesting turns a
-- conversation into a tree nobody can follow. Enforced in a BEFORE trigger,
-- since a CHECK constraint cannot look at another row.

-- ── messages: thread columns ────────────────────────────────────────────────
-- ON DELETE CASCADE: 063 lets a sender delete their own message; deleting a
-- thread's parent takes its replies with it (they would be orphaned otherwise).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID
  REFERENCES messages(id) ON DELETE CASCADE;

-- Denormalised so the channel list can render "3 replies" without a per-message
-- COUNT. Maintained by the triggers below.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS messages_parent_idx ON messages(parent_message_id, created_at)
  WHERE parent_message_id IS NOT NULL;

-- The channel view's hot query: top-level messages, newest first.
CREATE INDEX IF NOT EXISTS messages_toplevel_idx ON messages(conversation_id, created_at DESC)
  WHERE parent_message_id IS NULL;

-- ── Validate thread shape BEFORE the row lands ──────────────────────────────
-- Two invariants that RLS cannot express:
--   1. the parent must live in the SAME conversation (else a reply would leak a
--      message into a thread its author cannot even see), and
--   2. the parent must itself be top-level (no nesting).
CREATE OR REPLACE FUNCTION validate_message_thread()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parent_conv   UUID;
  v_parent_parent UUID;
BEGIN
  IF NEW.parent_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT conversation_id, parent_message_id
    INTO v_parent_conv, v_parent_parent
    FROM messages WHERE id = NEW.parent_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent message does not exist';
  END IF;
  IF v_parent_conv <> NEW.conversation_id THEN
    RAISE EXCEPTION 'parent message belongs to a different conversation';
  END IF;
  IF v_parent_parent IS NOT NULL THEN
    RAISE EXCEPTION 'cannot reply to a reply — threads are one level deep';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_validate_thread ON messages;
CREATE TRIGGER messages_validate_thread
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION validate_message_thread();

-- ── Keep reply_count honest when a reply is deleted (063) ───────────────────
-- GREATEST(...,0) is belt-and-braces against a count ever going negative.
-- When the PARENT is deleted its replies cascade here too, but the UPDATE then
-- matches no row, so this is a harmless no-op in that path.
CREATE OR REPLACE FUNCTION on_message_deleted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.parent_message_id IS NOT NULL THEN
    UPDATE messages
       SET reply_count = GREATEST(reply_count - 1, 0)
     WHERE id = OLD.parent_message_id;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS messages_after_delete ON messages;
CREATE TRIGGER messages_after_delete
  AFTER DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION on_message_deleted();

-- ── on_new_message: thread-aware ────────────────────────────────────────────
-- Supersedes 084. Everything 084 established is preserved verbatim — the
-- attachment-aware preview (from 060/062), the mention branch, and the
-- collapse-only-type='info' rule that stops a mention ping being swallowed.
-- New here: reply_count maintenance, the &t= thread link, and the narrowed
-- recipient set for replies.
CREATE OR REPLACE FUNCTION on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name   TEXT;
  v_is_reply      BOOLEAN := NEW.parent_message_id IS NOT NULL;
  v_link          TEXT := '/messages?c=' || NEW.conversation_id
                          || CASE WHEN NEW.parent_message_id IS NOT NULL
                                  THEN '&t=' || NEW.parent_message_id ELSE '' END;
  v_preview       TEXT := COALESCE(NULLIF(left(NEW.body, 140), ''), '📎 ' || COALESCE(NEW.attachment_name, 'Attachment'));
  v_title         TEXT;
  v_parent_author UUID;
  v_mentioned     BOOLEAN;
  r_user          UUID;
BEGIN
  -- Structural, not best-effort: these must not be swallowed.
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;

  IF v_is_reply THEN
    UPDATE messages SET reply_count = reply_count + 1 WHERE id = NEW.parent_message_id;
    SELECT sender_id INTO v_parent_author FROM messages WHERE id = NEW.parent_message_id;
  END IF;

  -- Best-effort: notifying recipients must NEVER block the chat message.
  BEGIN
    SELECT full_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;
    SELECT title INTO v_title FROM conversations WHERE id = NEW.conversation_id;

    FOR r_user IN
      SELECT cp.user_id
        FROM conversation_participants cp
       WHERE cp.conversation_id = NEW.conversation_id
         AND cp.user_id <> NEW.sender_id
         AND (
           -- Channel message → everyone. A manager's broadcast must reach all.
           NOT v_is_reply
           -- A mention always gets through, thread or not.
           OR cp.user_id = ANY (NEW.mentions)
           -- Otherwise, only people actually in this thread.
           OR cp.user_id = v_parent_author
           OR EXISTS (
             SELECT 1 FROM messages m
              WHERE m.parent_message_id = NEW.parent_message_id
                AND m.sender_id = cp.user_id
           )
         )
    LOOP
      v_mentioned := r_user = ANY (NEW.mentions);

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
          VALUES (
            r_user,
            COALESCE(v_sender_name, 'New message')
              || CASE WHEN v_is_reply THEN ' replied in a thread' ELSE '' END,
            v_preview, 'info', v_link
          );
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
