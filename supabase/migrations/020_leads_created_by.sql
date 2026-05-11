-- Track who added each lead to the system
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
