-- Add client requirements to appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_requirements TEXT;

-- Project approvals table: agent books appointment → admin approves → dev gets task
CREATE TABLE IF NOT EXISTS project_approvals (
  id              UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  appointment_id  UUID REFERENCES appointments(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'declined')),
  client_requirements TEXT,
  approved_by     UUID REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  due_date        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_approvals_status  ON project_approvals(status);
CREATE INDEX IF NOT EXISTS idx_project_approvals_lead_id ON project_approvals(lead_id);
