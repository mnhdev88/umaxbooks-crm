-- 117: Emails inbox (sidebar) — per-user unread state for lead email conversations
--
-- One row per (user, lead) recording when that user last opened the lead's email
-- conversation. A conversation is unread for a user when it has a lead reply
-- (email_sends.direction = 'inbound') newer than their read_at. Without a row the
-- baseline is "the last 7 days", so historic replies don't all show as unread.
-- Per user, so an admin opening a thread doesn't clear it for the agent.

CREATE TABLE IF NOT EXISTS email_thread_reads (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_email_thread_reads_lead ON email_thread_reads (lead_id);

ALTER TABLE email_thread_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own_email_thread_reads" ON email_thread_reads;
CREATE POLICY "own_email_thread_reads" ON email_thread_reads
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Lead replies are a small slice of email_sends; this keeps the badge count an
-- index-only walk instead of a scan over rows carrying HTML bodies.
CREATE INDEX IF NOT EXISTS idx_email_sends_inbound_lead
  ON email_sends (lead_id, sent_at) WHERE direction = 'inbound';

-- Number of conversations with unread lead replies, for the sidebar badge.
-- SECURITY INVOKER: the leads join applies the caller's leads RLS (sales managers
-- → their team). Sales agents' RLS also shows unassigned leads, so they are pinned
-- to leads assigned to them or mail from their own mailbox — same as the inbox.
CREATE OR REPLACE FUNCTION email_unread_count()
RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT count(DISTINCT e.lead_id)::int
  FROM email_sends e
  JOIN leads l ON l.id = e.lead_id
  LEFT JOIN email_thread_reads r
    ON r.lead_id = e.lead_id AND r.user_id = (SELECT auth.uid())
  WHERE e.direction = 'inbound'
    AND e.sent_at > COALESCE(r.read_at, NOW() - INTERVAL '7 days')
    AND (
      (SELECT get_my_role()) <> 'sales_agent'
      OR l.assigned_agent_id = (SELECT auth.uid())
      OR e.mailbox_user_id = (SELECT auth.uid())
    )
$$;

REVOKE ALL ON FUNCTION email_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION email_unread_count() TO authenticated;
