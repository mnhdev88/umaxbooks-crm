-- Add on-page SEO snapshot columns to before_after_comparisons
-- Mirrors the pagespeed_* columns added in 017_pagespeed_columns.sql

ALTER TABLE before_after_comparisons
  ADD COLUMN IF NOT EXISTS seo_before      jsonb,
  ADD COLUMN IF NOT EXISTS seo_before_url  text,
  ADD COLUMN IF NOT EXISTS seo_before_at   timestamptz,
  ADD COLUMN IF NOT EXISTS seo_after       jsonb,
  ADD COLUMN IF NOT EXISTS seo_after_url   text,
  ADD COLUMN IF NOT EXISTS seo_after_at    timestamptz;
