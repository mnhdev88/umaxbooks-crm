-- Track whether agent notes have been locked (sent to developer)
ALTER TABLE audits ADD COLUMN IF NOT EXISTS agent_notes_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS agent_notes_notified_at TIMESTAMPTZ;
