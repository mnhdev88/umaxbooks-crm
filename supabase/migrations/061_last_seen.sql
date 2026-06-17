-- "Last seen" for chat.
--
-- Presence (Supabase Realtime) covers "online now" but remembers nothing once a
-- user disconnects. To show "Last seen 5m ago" for offline users we persist a
-- heartbeat timestamp. The CRM shell calls touch_last_seen() on load, on a 60s
-- interval, and when the tab regains focus.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- SECURITY DEFINER: a user can stamp only their own row, cheaply, without
-- needing a broad UPDATE grant on profiles.
CREATE OR REPLACE FUNCTION touch_last_seen()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_seen_at = NOW() WHERE id = auth.uid();
$$;

COMMENT ON COLUMN profiles.last_seen_at IS 'Heartbeat timestamp for chat "last seen"; updated by touch_last_seen().';
