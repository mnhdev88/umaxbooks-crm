-- Thread-style notes for agent → developer communication per lead
CREATE TABLE IF NOT EXISTS audit_notes (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES profiles(id) NOT NULL,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE audit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read audit notes"
  ON audit_notes FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert audit notes"
  ON audit_notes FOR INSERT WITH CHECK (auth.role() = 'authenticated');
