-- 115: Disk IO reductions (Supabase "depleting Disk IO Budget" warning, Nov 2026)
--
-- Two hot paths that cost disk IO far out of proportion to their value:
--
-- 1. send-scheduled-emails cron runs EVERY MINUTE (1,440×/day) and asks for
--    email_sends WHERE status = 'scheduled' AND scheduled_at <= now(). There was
--    no index for that, so every run scanned the whole table — whose rows carry
--    full HTML bodies (~7 KB each). A partial index holds only the handful of
--    scheduled rows, so the check becomes a tiny index lookup.
--
-- 2. touch_last_seen() is called by every open CRM tab on load, on refocus and
--    on a timer. Each call was an UPDATE (new row version + WAL write + later
--    vacuum) even when last_seen_at had been set seconds earlier. "Last seen"
--    only needs minute-level accuracy, so skip the write when the stamp is
--    already fresh. The function keeps its signature, so the app needs no change.

CREATE INDEX IF NOT EXISTS idx_email_sends_scheduled_due
  ON email_sends (scheduled_at)
  WHERE status = 'scheduled';

CREATE OR REPLACE FUNCTION touch_last_seen()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles
     SET last_seen_at = NOW()
   WHERE id = auth.uid()
     AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '4 minutes');
$$;
