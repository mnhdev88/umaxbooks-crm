-- Find ALL remaining duplicates (by phone, email, and company name)

-- PHONE DUPLICATES
SELECT 'PHONE' as type, l1.id as keep_id, l1.company_name as keep_name, l1.created_at as keep_date,
       l2.id as delete_id, l2.company_name as delete_name, l2.created_at as delete_date,
       l1.phone as matched_value
FROM leads l1
JOIN leads l2 ON LOWER(COALESCE(l1.phone, '')) = LOWER(COALESCE(l2.phone, ''))
WHERE l1.phone IS NOT NULL AND l1.phone != ''
  AND l1.created_at < l2.created_at
  AND l1.id != l2.id

UNION ALL

-- EMAIL DUPLICATES
SELECT 'EMAIL' as type, l1.id as keep_id, l1.company_name as keep_name, l1.created_at as keep_date,
       l2.id as delete_id, l2.company_name as delete_name, l2.created_at as delete_date,
       l1.email as matched_value
FROM leads l1
JOIN leads l2 ON LOWER(COALESCE(l1.email, '')) = LOWER(COALESCE(l2.email, ''))
WHERE l1.email IS NOT NULL AND l1.email != ''
  AND l1.created_at < l2.created_at
  AND l1.id != l2.id

UNION ALL

-- COMPANY NAME DUPLICATES
SELECT 'COMPANY' as type, l1.id as keep_id, l1.company_name as keep_name, l1.created_at as keep_date,
       l2.id as delete_id, l2.company_name as delete_name, l2.created_at as delete_date,
       l1.company_name as matched_value
FROM leads l1
JOIN leads l2 ON LOWER(l1.company_name) = LOWER(l2.company_name)
WHERE l1.created_at < l2.created_at
  AND l1.id != l2.id

ORDER BY type, keep_date;
