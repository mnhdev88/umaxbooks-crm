-- Backfill: promote stuck "New" leads to "Contacted".
--
-- Until this point, neither a completed AI call nor the post-call auto cold-outreach
-- email (sendTemplateEmailToLead) advanced the lead's status, unlike the manual send
-- path (sendLeadEmail). So leads that had been contacted could remain in "New" forever.
-- The code is now fixed going forward; this catches up the rows already stranded.
--
-- A lead qualifies when it is still "New" and has had first contact: an AI call
-- (last_call_at set) OR an email sent (cold-outreach guard, or a "sent" row in
-- email_sends).

UPDATE leads
SET status = 'Contacted'
WHERE status = 'New'
  AND (
    last_call_at IS NOT NULL
    OR cold_outreach_sent_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.lead_id = leads.id
        AND es.status = 'sent'
    )
  );
