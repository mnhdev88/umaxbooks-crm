-- Add state/province column to leads (was missing alongside address/city/zip_code/country)

ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT;
