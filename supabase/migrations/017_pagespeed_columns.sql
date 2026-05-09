-- Add PageSpeed Insights data columns to before_after_comparisons

ALTER TABLE before_after_comparisons
  ADD COLUMN IF NOT EXISTS pagespeed_before      jsonb,
  ADD COLUMN IF NOT EXISTS pagespeed_before_url  text,
  ADD COLUMN IF NOT EXISTS pagespeed_before_at   timestamptz,
  ADD COLUMN IF NOT EXISTS pagespeed_after       jsonb,
  ADD COLUMN IF NOT EXISTS pagespeed_after_url   text,
  ADD COLUMN IF NOT EXISTS pagespeed_after_at    timestamptz;
