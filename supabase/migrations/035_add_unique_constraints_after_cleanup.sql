-- Migration: Add unique constraints AFTER duplicates are resolved
--
-- This migration should only be run AFTER all duplicates have been resolved
-- using the /admin/duplicates dashboard.
--
-- If you get "Key is duplicated" errors, it means there are still unresolved duplicates.
-- Go to /admin/duplicates and resolve them first.

-- Phone: prevent duplicate phone numbers (ignoring nulls and empty strings)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone_unique
  ON leads(LOWER(phone))
  WHERE phone IS NOT NULL AND phone != '';

-- Email: prevent duplicate emails (ignoring nulls and empty strings)
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_email_unique
  ON leads(LOWER(email))
  WHERE email IS NOT NULL AND email != '';
