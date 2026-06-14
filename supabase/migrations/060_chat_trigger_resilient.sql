-- Fix "message failed to send" + make the chat trigger resilient.
--
-- Root cause (confirmed from the client error "column \"link\" does not exist"):
-- the cloud `notifications` table is missing the `link` column that migration
-- 002 was supposed to add. The 059 on_new_message() trigger inserts a
-- notification WITH a link, that statement errors, and because it runs in the
-- same transaction as the message INSERT, the whole send rolls back.
--
-- This also means the 058 web-push trigger (which reads NEW.link) has been
-- broken on this DB. Adding the column fixes both.
--
-- Two-part fix, both idempotent / safe to re-run:
--   1. Add the missing notifications.link column.
--   2. Wrap the trigger's notification work in an exception block so a
--      notification problem can NEVER block a chat message again.

-- 1. Realign the drifted schema.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

-- 2. Resilient trigger.
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

  -- Best-effort: notify the other participants (→ web push via 058).
  -- Any failure here is swallowed so the chat message still commits.
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
