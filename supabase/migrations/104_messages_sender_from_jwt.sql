-- 104_messages_sender_from_jwt.sql
--
-- "Send failed: new row violates row-level security policy for table messages" (42501).
--
-- The INSERT policy requires `sender_id = auth.uid()`, but sender_id came from a
-- server-rendered `userId` prop threaded through DashboardShell → ChatWidget → ChatWindow
-- (and messages/page → MessagesClient). After an in-tab account switch that prop can still
-- hold the previous user's id while the Supabase client already carries the new user's JWT,
-- so the two disagree and the send is rejected. Observed 2026-08-12: one browser signed in
-- as one agent at 09:03 and another at 09:04:45, then alternated 403/201 on the same DM.
--
-- The client should never have been the source of truth for who is sending. Stamp sender_id
-- from the JWT instead. RLS WITH CHECK is evaluated against the row as it stands *after*
-- BEFORE triggers, so forcing it here makes that clause unfalsifiable rather than merely
-- usually-true — a stale prop can no longer fail a send, and can no longer forge one either.

-- Lets callers omit sender_id entirely.
ALTER TABLE messages ALTER COLUMN sender_id SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION set_message_sender()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  -- SECURITY INVOKER + no auth.uid() fallback: a NULL here means the insert is running
  -- without a JWT (service role, SQL editor, a cron job). Those callers are trusted and
  -- must be able to name a sender explicitly, so only overwrite when a JWT is present.
  IF auth.uid() IS NOT NULL THEN
    NEW.sender_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_set_sender ON messages;
CREATE TRIGGER messages_set_sender
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION set_message_sender();

COMMENT ON COLUMN messages.sender_id IS
  'Always the authenticated sender — stamped from auth.uid() by messages_set_sender (104). Any value supplied by the client is ignored.';
