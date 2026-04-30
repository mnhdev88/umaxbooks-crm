-- Add 'sales_agent' to the role CHECK constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'agent', 'sales_agent', 'developer'));

-- Allow sales_agent the same RLS access as agent on leads (read + insert + update own)
-- (existing policies already cover role IN ('admin','agent') — add sales_agent where needed)
