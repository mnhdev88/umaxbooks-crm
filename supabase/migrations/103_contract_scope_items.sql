-- 103_contract_scope_items.sql
--
-- Editable Scope of Services on service agreements.
--
-- Before this, section 4 of the agreement ("Scope of Services") was hardcoded
-- HTML in two places — the signing page and the PDF builder — so every contract
-- promised the same seven items regardless of package, and the rep sending it
-- never saw what the client would be shown.
--
-- Now the rep sees and edits the list in the Send Service Agreement modal,
-- pre-filled per package from app_settings.contract_package_defaults. The lines
-- are snapshotted here at send time — like payment_schedule in 102 — so editing
-- a package's defaults later cannot change what an existing client agreed to.
--
-- Contracts sent before this migration have a null scope_items and keep
-- rendering the original wording (DEFAULT_SCOPE_ITEMS in lib/contract-plan.ts).

ALTER TABLE contracts
  -- ["Website Design & Development", ...] — frozen at send time.
  ADD COLUMN IF NOT EXISTS scope_items jsonb;

-- No backfill of app_settings.contract_package_defaults is needed: a package
-- whose stored defaults carry no "scope" key falls back to DEFAULT_SCOPE_ITEMS
-- in readPackageDefaults(), and the key is written the first time an admin saves
-- Settings → Contract Package Defaults.
