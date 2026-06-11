-- 054_distinct_lead_cities_fn.sql
-- The leads list moved to server-side pagination, so the browser no longer holds
-- every lead to build the City filter dropdown. This function returns the distinct
-- non-empty cities (one cheap query, backed by idx_leads_city from migration 053).
CREATE OR REPLACE FUNCTION distinct_lead_cities()
RETURNS TABLE (city text)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT l.city
  FROM leads l
  WHERE l.city IS NOT NULL AND l.city <> ''
  ORDER BY l.city
$$;

GRANT EXECUTE ON FUNCTION distinct_lead_cities() TO authenticated;
