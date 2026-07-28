-- Reading a chat should silence its bell notification.
--
-- Symptom: open a conversation, read the message, and the chat badge clears —
-- but the notification bell keeps showing it, forever. Confirmed on the cloud
-- DB: 19 of the 20 most recent unread chat notifications belonged to
-- conversations whose last_read_at was already past the notification.
--
-- Root cause: unread lives in two places that were never linked.
--   * conversation_participants.last_read_at  → chat badge (chat_unread_count)
--   * notifications rows from on_new_message  → the bell
-- Both clients (ChatWindow.markRead + MessagesClient.openConversation) update
-- last_read_at only, so the notification row stays read = FALSE for good.
--
-- Fix: whenever last_read_at advances, mark that conversation's chat
-- notifications read in the same transaction. Doing it in the DB rather than in
-- the client means every surface benefits — the floating widget, the /messages
-- page, and a second browser tab that marked it read — without each having to
-- remember the second write.

-- ── Mark this participant's chat notifications read up to last_read_at ───────
-- Notification links look like '/messages?c=<conversation>' and, for a thread
-- reply, '/messages?c=<conversation>&t=<parent>'. The LIKE covers both, and
-- anchoring on the '?c=' prefix keeps it from matching any other link shape.
--
-- created_at <= last_read_at is the important guard: a message that arrived
-- AFTER the read timestamp is genuinely unread and must keep its ping. That is
-- what makes this safe to run on every UPDATE.
CREATE OR REPLACE FUNCTION public.clear_chat_notifications_on_read()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Best-effort, exactly like on_new_message: a notification problem must never
  -- block someone from reading their chat.
  BEGIN
    UPDATE notifications
       SET read = TRUE
     WHERE user_id = NEW.user_id
       AND read = FALSE
       AND created_at <= NEW.last_read_at
       AND (
         link = '/messages?c=' || NEW.conversation_id
         OR link LIKE '/messages?c=' || NEW.conversation_id || '&%'
       );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- Fires only when the read pointer actually moves forward. Receipt writes bump
-- delivered_at on their own, and the widget re-marks read on every incoming
-- message, so without this WHEN clause the UPDATE above would run constantly
-- for no reason.
DROP TRIGGER IF EXISTS participants_after_read ON conversation_participants;
CREATE TRIGGER participants_after_read
  AFTER UPDATE OF last_read_at ON conversation_participants
  FOR EACH ROW
  WHEN (NEW.last_read_at IS DISTINCT FROM OLD.last_read_at)
  EXECUTE FUNCTION public.clear_chat_notifications_on_read();

REVOKE EXECUTE ON FUNCTION public.clear_chat_notifications_on_read() FROM PUBLIC, anon;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Clear the stale pings that accumulated before the trigger existed, using the
-- same rule the trigger applies. Anything newer than last_read_at is left
-- unread, so genuinely-unseen messages still ping.
UPDATE notifications n
   SET read = TRUE
  FROM conversation_participants cp
 WHERE n.read = FALSE
   AND n.user_id = cp.user_id
   AND n.created_at <= cp.last_read_at
   AND (
     n.link = '/messages?c=' || cp.conversation_id
     OR n.link LIKE '/messages?c=' || cp.conversation_id || '&%'
   );

COMMENT ON FUNCTION public.clear_chat_notifications_on_read() IS
  'Marks a conversation''s bell notifications read when the participant''s last_read_at advances past them (096).';
