# Duplicate Leads System - Fix for Dashboard Error

## The Problem

The admin dashboard at `/admin/duplicates` shows error: **"Failed to load duplicates: {}""**

This happens because the database migration hasn't been applied yet.

---

## The Solution: 3 Steps

### Step 1: Apply the Migration ⚙️

Choose **ONE** of these options:

#### Option A: Supabase Dashboard (Easiest - No Setup Required)

```
1. Open: https://app.supabase.com
2. Select your project
3. Click "SQL Editor" (left sidebar)
4. Click "New Query"
5. Copy entire contents of:
   → supabase/migrations/034_duplicate_leads_constraints.sql
6. Paste into the editor
7. Click "Run" (or Ctrl+Enter)
8. Wait for success message ✅
```

**That's it!** The migration is now applied.

---

#### Option B: PowerShell Script (Automated)

```powershell
# From project directory
cd "d:\downloads\Antigravity Projct\claude\umax-crm"

# Set your Supabase credentials (from https://app.supabase.com/project/settings/api)
$env:NEXT_PUBLIC_SUPABASE_URL = "your_url"
$env:SUPABASE_SERVICE_ROLE_KEY = "your_service_role_key"

# Run the migration
node scripts/apply-migration.mjs
```

**Where to find your credentials:**
1. https://app.supabase.com
2. Select your project
3. Settings → API
4. Copy the URL and Service Role Key

---

#### Option C: NPM Package Manager

```bash
npm run apply-migration
```

(Requires same environment variables as Option B)

---

### Step 2: Verify It Worked ✅

Go to: `http://localhost:3000/admin/duplicates`

You should see:
- "0 flagged pairs awaiting review" (if no duplicates yet)
- A blue button "Scan for New Duplicates"
- NO ERROR MESSAGE

---

### Step 3: Scan for Your Duplicates 🔍

1. Click **"Scan for New Duplicates"** button
2. Wait for scan to complete
3. It will show: `"Found X duplicates. Flagged Y pairs for review."`
4. Review the duplicate pairs (like your IVL-298 & IVL-299)
5. For each pair, click **"Resolved"** after you merge/delete

---

## What the Migration Does

```sql
-- Creates a table to track duplicates
CREATE TABLE duplicate_lead_records (...)

-- Adds columns to leads table
ALTER TABLE leads ADD is_merged BOOLEAN;
ALTER TABLE leads ADD merged_into_id UUID;

-- Prevents future duplicates at database level
CREATE UNIQUE INDEX idx_leads_phone_unique ON leads(LOWER(phone));
CREATE UNIQUE INDEX idx_leads_email_unique ON leads(LOWER(email));

-- Adds performance indexes
CREATE INDEX idx_leads_phone_lower ON leads(LOWER(phone));
CREATE INDEX idx_leads_email_lower ON leads(LOWER(email));
```

---

## Quick Reference

| What | Where | Action |
|------|-------|--------|
| **Migration SQL** | `supabase/migrations/034_duplicate_leads_constraints.sql` | Copy & run in Supabase Dashboard |
| **Admin Dashboard** | `http://localhost:3000/admin/duplicates` | Scan & resolve duplicates |
| **Documentation** | `docs/DUPLICATE_LEADS_CLEANUP.md` | Read for details |
| **Setup Guide** | `DUPLICATE_LEADS_SETUP.md` | Read for overview |
| **Apply Script** | `scripts/apply-migration.mjs` | Run if you have credentials |

---

## How It Works (After Migration Applied)

### Prevention (Already Active)
When creating a new lead, the form checks for duplicates by:
- Phone number
- Email address  
- Company name

If found, saves are blocked. ✅

### Detection (After Scan)
The dashboard scans your entire database and finds:
- Phone number matches
- Email matches
- Company name matches

Shows them side-by-side for review. ✅

### Resolution
1. Compare the two leads
2. Copy unique data from duplicate → primary
3. Delete the duplicate lead
4. Click "Resolved"

Status is saved in `duplicate_lead_records` table. ✅

---

## Your Duplicate (IVL-298 & IVL-299)

The scan will find these automatically:

| Field | Value |
|-------|-------|
| Primary | IVL-299 (Callback Booked, May 19) |
| Duplicate | IVL-298 (New, May 19) |
| Match Type | Phone + Email + Company Name |
| Action | Keep 299, delete 298 |

---

## Troubleshooting

### Still seeing error after migration?

1. **Hard refresh:** Ctrl+Shift+R
2. **Clear cache:** Ctrl+Shift+Delete
3. **Restart dev server:** Kill terminal, npm run dev
4. **Check migration was applied:** https://app.supabase.com → Database → Tables → Look for `duplicate_lead_records`

### Don't know your Supabase credentials?

1. Open https://app.supabase.com
2. Select your project
3. Settings (⚙️) → API
4. Under "Project URL" and "Service Role Secret"
5. Copy both values

### Migration fails with "permission denied"?

Make sure you're using `SUPABASE_SERVICE_ROLE_KEY`, not the anon key.

### "Table already exists"?

That's fine! The migration uses `IF NOT EXISTS` so it's idempotent.

---

## Next: Running the Scan

Once migration is applied:

1. ✅ Visit: http://localhost:3000/admin/duplicates
2. ✅ Click: "Scan for New Duplicates"
3. ✅ Review: All duplicate pairs found
4. ✅ Resolve: Delete duplicates, mark as done

---

## Support

- **Detailed docs**: `docs/DUPLICATE_LEADS_CLEANUP.md`
- **Setup guide**: `DUPLICATE_LEADS_SETUP.md`
- **Migration details**: `APPLY_MIGRATION.md`
- **Source code**: `lib/duplicate-leads-cleanup.ts`
