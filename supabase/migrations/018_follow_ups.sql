-- Follow-up callbacks table
CREATE TABLE IF NOT EXISTS follow_ups (
  id           UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id      UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  notes        TEXT,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMP WITH TIME ZONE,
  notified_at  TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_user_status   ON follow_ups(user_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_lead          ON follow_ups(lead_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled_at  ON follow_ups(scheduled_at);

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage follow_ups"
  ON follow_ups FOR ALL USING (auth.role() = 'authenticated');
