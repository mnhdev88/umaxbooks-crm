-- Force delete the duplicate Mightneed_A_Detail lead (newer one)
-- All related records cascade automatically

DELETE FROM leads
WHERE id = (
  SELECT id FROM leads
  WHERE LOWER(company_name) = LOWER('Mightneed_A_Detail')
  ORDER BY created_at DESC
  LIMIT 1
);
