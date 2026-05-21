-- Find the last remaining duplicate lead and see what to delete

-- STEP 1: Find the duplicate
SELECT
  'PRIMARY (KEEP)' as action,
  l1.id,
  l1.company_name,
  l1.phone,
  l1.email,
  l1.created_at
FROM leads l1
JOIN leads l2 ON LOWER(COALESCE(l1.phone, '')) = LOWER(COALESCE(l2.phone, ''))
WHERE l1.phone IS NOT NULL AND l1.phone != ''
  AND l1.created_at < l2.created_at
  AND l1.id != l2.id
LIMIT 1

UNION ALL

SELECT
  'DUPLICATE (DELETE)' as action,
  l2.id,
  l2.company_name,
  l2.phone,
  l2.email,
  l2.created_at
FROM leads l1
JOIN leads l2 ON LOWER(COALESCE(l1.phone, '')) = LOWER(COALESCE(l2.phone, ''))
WHERE l1.phone IS NOT NULL AND l1.phone != ''
  AND l1.created_at < l2.created_at
  AND l1.id != l2.id
LIMIT 1;

-- STEP 2: After you identify the DUPLICATE (DELETE) lead ID above, run this:
-- DELETE FROM leads WHERE id = 'COPY_DUPLICATE_ID_HERE';
