-- 102_contract_installment_plan.sql
--
-- Installment ("EMI") plans on service agreements.
--
-- Before this, an Installment contract carried nothing but payment_type and
-- total_amount; the actual breakdown was three blank boxes the CLIENT filled in
-- on the signing page (first_payment / installment_payment / balance_payment),
-- with no guidance and no check that they added up to the total.
--
-- Now the REP builds the plan when sending: total, a down payment due at
-- signing, and N equal monthly payments. lib/contract-plan.ts derives the
-- per-month figure and a dated schedule, /api/contracts recomputes it
-- server-side, and the signing page shows it read-only.
--
-- The old three columns are kept and are still what the portal and the PDF's
-- payment summary read — they are now DERIVED from the plan at signing time
-- rather than typed by the client. Contracts sent before this migration have a
-- null plan and keep the old editable behaviour.

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS down_payment             numeric,
  ADD COLUMN IF NOT EXISTS installment_count        integer,
  ADD COLUMN IF NOT EXISTS installment_amount       numeric,
  ADD COLUMN IF NOT EXISTS final_installment_amount numeric,
  -- [{ kind, label, amount, due_date }] — frozen at send time so the agreed
  -- schedule survives any later change to the maths in the app.
  ADD COLUMN IF NOT EXISTS payment_schedule         jsonb;

-- Admin-editable suggested totals / down-payment % / month counts per package,
-- used to pre-fill the contract modal. Read by any signed-in rep through
-- /api/settings/contract-packages; only admins can write it.
INSERT INTO app_settings (key, value) VALUES (
  'contract_package_defaults',
  '{
    "Startup – Basic Website Design":       { "total": 799,  "down_pct": 50, "months": 3 },
    "Professional – Advanced Design + SEO": { "total": 1499, "down_pct": 50, "months": 4 },
    "Enterprise – Full Suite + Support":    { "total": 2999, "down_pct": 50, "months": 6 }
  }'
) ON CONFLICT (key) DO NOTHING;
