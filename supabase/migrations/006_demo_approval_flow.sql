-- Extend project_approvals for demo submission flow
ALTER TABLE project_approvals
  ADD COLUMN IF NOT EXISTS demo_url       TEXT,
  ADD COLUMN IF NOT EXISTS revision_notes TEXT,
  ADD COLUMN IF NOT EXISTS developer_id   UUID REFERENCES profiles(id);
