-- 078_distinct_lead_states_fn.sql
-- Leads list filter bar swaps the City dropdown for a State dropdown. Mirrors
-- distinct_lead_cities() (migration 054) so the browser doesn't hold every
-- lead just to build the filter options.
CREATE INDEX IF NOT EXISTS idx_leads_state ON leads(state);

CREATE OR REPLACE FUNCTION distinct_lead_states()
RETURNS TABLE (state text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT l.state
  FROM leads l
  WHERE l.state IS NOT NULL AND l.state <> ''
  ORDER BY l.state
$$;

GRANT EXECUTE ON FUNCTION distinct_lead_states() TO authenticated;
