-- Dated contact notes for leads — any role can add

CREATE TABLE IF NOT EXISTS lead_contact_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id),
  contact_date date NOT NULL DEFAULT current_date,
  note         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lead_contact_notes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read notes for leads they can already see
CREATE POLICY "Anyone can read lead_contact_notes"
  ON lead_contact_notes FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can insert their own notes
CREATE POLICY "Authenticated users can insert lead_contact_notes"
  ON lead_contact_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own notes; admins can delete any
CREATE POLICY "Users can delete own notes"
  ON lead_contact_notes FOR DELETE
  USING (auth.uid() = user_id OR get_my_role() = 'admin');
