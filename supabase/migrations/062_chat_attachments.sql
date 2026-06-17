-- File attachments for chat.
--
-- Files live in a PRIVATE Supabase Storage bucket (chat-attachments), pathed by
-- conversation id: "{conversation_id}/{uuid}-{filename}". Access is gated by the
-- same is_conversation_participant() helper used everywhere else, so only the
-- two people in a DM can upload to / read from that folder. The client renders
-- attachments via short-lived signed URLs.
--
-- The message row carries the attachment metadata; a message may now be
-- text-only, file-only, or both.

-- ── messages: attachment columns + relaxed content rule ─────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_path TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;

-- body was NOT NULL + CHECK(length(trim(body))>0); allow file-only messages.
ALTER TABLE messages ALTER COLUMN body DROP NOT NULL;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_body_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (
  (body IS NOT NULL AND length(trim(body)) > 0) OR attachment_path IS NOT NULL
);

-- ── Notification preview: cope with file-only messages (NULL body) ──────────
CREATE OR REPLACE FUNCTION on_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sender_name TEXT;
  v_link        TEXT := '/messages?c=' || NEW.conversation_id;
  v_preview     TEXT := COALESCE(NULLIF(left(NEW.body, 140), ''), '📎 ' || COALESCE(NEW.attachment_name, 'Attachment'));
  r_user        UUID;
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;

  BEGIN
    SELECT full_name INTO v_sender_name FROM profiles WHERE id = NEW.sender_id;
    FOR r_user IN
      SELECT user_id FROM conversation_participants
      WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
    LOOP
      DELETE FROM notifications WHERE user_id = r_user AND read = FALSE AND link = v_link;
      INSERT INTO notifications (user_id, title, message, type, link)
        VALUES (r_user, COALESCE(v_sender_name, 'New message'), v_preview, 'info', v_link);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$;

-- ── Private storage bucket (25 MB cap) ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', FALSE, 26214400)
ON CONFLICT (id) DO NOTHING;

-- ── Storage RLS: only conversation participants can read/write the folder ───
-- The first path segment is the conversation id.
DROP POLICY IF EXISTS "Chat attachments readable by participants" ON storage.objects;
CREATE POLICY "Chat attachments readable by participants"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-attachments'
    AND is_conversation_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  );

DROP POLICY IF EXISTS "Chat attachments writable by participants" ON storage.objects;
CREATE POLICY "Chat attachments writable by participants"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND is_conversation_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  );
