# Fix Migration Error: Duplicate Phone Numbers Exist

## The Error

```
Failed to run sql query: ERROR: 23505: could not create unique index "idx_leads_phone_unique"
DETAIL: Key (lower(phone))=((602) 635-1740) is duplicated.
```

## Why It Happened

The migration tried to create a **unique constraint** on phone numbers, but **duplicates already exist** in your database. The phone `(602) 635-1740` appears more than once.

---

## The Fix: 2-Step Process

### Step 1: Run the Corrected Migration (Just Now!)

**In Supabase Dashboard:**
1. SQL Editor → New Query
2. Clear the previous query
3. **Copy the ENTIRE contents** of:
   ```
   supabase/migrations/034_duplicate_leads_constraints.sql
   ```
4. Paste into editor
5. Click **Run**

**What's different:**
- ✅ Creates `duplicate_lead_records` table
- ✅ Creates performance indexes
- ✅ Adds tracking columns (`is_merged`, `merged_into_id`)
- ❌ Skips unique constraints (they're commented out)

This should succeed now ✅

---

### Step 2: Resolve All Duplicates (Next)

1. **Visit:** http://localhost:3000/admin/duplicates
2. **Click:** "Scan for New Duplicates"
3. **Review:** All duplicate pairs (including the one with `(602) 635-1740`)
4. **For each pair:**
   - Decide which to keep
   - Delete the other
   - Click "Resolved"
5. **Repeat** until no duplicates remain

---

### Step 3: Add Unique Constraints (After Cleanup)

Once ALL duplicates are resolved:

1. SQL Editor → New Query
2. Copy entire contents of:
   ```
   supabase/migrations/035_add_unique_constraints_after_cleanup.sql
   ```
3. Paste & Run

This will:
- ✅ Create unique index on phone
- ✅ Create unique index on email
- ✅ Prevent future duplicates at database level

---

## Current Status

| Step | Status | Action |
|------|--------|--------|
| 1. Run corrected migration | ⏳ **NOW** | Copy & run updated 034 migration |
| 2. Resolve duplicates | Next | Use `/admin/duplicates` dashboard |
| 3. Add unique constraints | Last | Run migration 035 |

---

## Quick Copy-Paste

### Migration 034 (Run Now)

```sql
-- Migration: Add constraints and cleanup for duplicate leads

-- Create a table to track which leads were marked as duplicates during cleanup
CREATE TABLE IF NOT EXISTS duplicate_lead_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  duplicate_lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  duplicate_reason TEXT NOT NULL,
  status TEXT DEFAULT 'flagged' CHECK (status IN ('flagged', 'merged', 'manual_review')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  merged_at TIMESTAMPTZ,
  merged_by UUID REFERENCES profiles(id),
  UNIQUE(primary_lead_id, duplicate_lead_id)
);

ALTER TABLE duplicate_lead_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view duplicate records"
  ON duplicate_lead_records FOR SELECT
  USING (get_my_role() = 'admin');

CREATE POLICY "Admins can manage duplicate records"
  ON duplicate_lead_records FOR ALL
  USING (get_my_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_leads_phone_lower ON leads(LOWER(phone)) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON leads(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_company_lower ON leads(LOWER(company_name));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS merged_into_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_merged_into ON leads(merged_into_id) WHERE merged_into_id IS NOT NULL;
```

---

## What Next?

1. ✅ Run the corrected migration
2. ✅ Refresh `/admin/duplicates` (hard refresh: Ctrl+Shift+R)
3. ✅ Click "Scan for New Duplicates"
4. ✅ Resolve each pair
5. ✅ Then run migration 035

---

## If It Still Fails

**Error:** "Column already exists"
- The partial migration already ran
- That's OK! Continue with step 2 (resolve duplicates)

**Error:** Still mentions unique constraint
- There are still unresolved duplicates
- Scan the dashboard again
- Look for any leads with matching phone/email

**Need help finding duplicates?**
- Dashboard will show them all when you click "Scan"
- They'll be grouped by phone/email/company name matches

---

## Duplicate Phones Found

The system detected `(602) 635-1740` is duplicated. After you run the corrected migration:

1. Dashboard will show which leads have this phone
2. You'll see side-by-side comparison
3. Decide which to keep
4. Delete the duplicate
5. Mark as "Resolved"

---

## Support

- **This file:** `FIX_MIGRATION_ERROR.md`
- **Full docs:** `docs/DUPLICATE_LEADS_CLEANUP.md`
- **Setup:** `DUPLICATE_LEADS_SETUP.md`
