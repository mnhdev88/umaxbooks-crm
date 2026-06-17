-- Delete chat messages (and their attachments).
--
-- A sender can delete their own message ("remove for everyone"); the matching
-- storage object is removed client-side by the uploader. REPLICA IDENTITY FULL
-- makes DELETE realtime events carry the full old row, so the conversation_id
-- filter on the chat channels matches and the other person's window updates.

-- messages: sender may delete their own rows.
DROP POLICY IF EXISTS "Senders can delete own messages" ON messages;
CREATE POLICY "Senders can delete own messages"
  ON messages FOR DELETE
  USING (sender_id = auth.uid());

-- Ensure DELETE realtime payloads include conversation_id (not just the PK).
ALTER TABLE messages REPLICA IDENTITY FULL;

-- storage: the uploader may delete their own attachment.
DROP POLICY IF EXISTS "Chat attachments deletable by owner" ON storage.objects;
CREATE POLICY "Chat attachments deletable by owner"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-attachments' AND owner = auth.uid());
