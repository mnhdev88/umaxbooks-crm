# Duplicate Leads Detection - Setup & Quick Start

## What Was Just Created

A complete duplicate detection and cleanup system with three layers:

### 1. **Prevention Layer** (Already Exists)
- Form validation in `LeadForm.tsx` blocks duplicate creation
- Checks phone, email, and company name before saving

### 2. **Database Layer** (NEW - Migration 034)
- Unique constraints on phone and email fields
- Tracking table (`duplicate_lead_records`) for found duplicates
- Merge status tracking on leads table

### 3. **Cleanup Tools** (NEW)
- **API**: `/api/admin/find-duplicates` - scans entire database
- **UI**: `/admin/duplicates` - admin dashboard to view & resolve
- **Library**: `lib/duplicate-leads-cleanup.ts` - detection logic

---

## Getting Started

### Step 1: Run the Database Migration

The migration file `034_duplicate_leads_constraints.sql` needs to be applied to your database:

```bash
# If using Supabase CLI:
supabase migration up

# Or manually:
# 1. Go to your Supabase dashboard
# 2. SQL Editor
# 3. Copy & paste contents of supabase/migrations/034_duplicate_leads_constraints.sql
# 4. Execute
```

### Step 2: Find All Existing Duplicates

Navigate to **`/admin/duplicates`** in your app (admin users only)

Click **"Scan for New Duplicates"** button.

**What it does:**
- Scans all leads in the database
- Finds matches by: phone, email, company name
- Flags them in the `duplicate_lead_records` table
- Shows them on the dashboard

### Step 3: Review & Resolve Each Pair

For each duplicate pair shown:

1. **Compare**: View both leads side-by-side
2. **Decide**: Which is primary, which is duplicate
3. **Consolidate**: Copy unique data from duplicate → primary
4. **Delete**: Remove the duplicate lead (all related records will cascade)
5. **Mark**: Click "Resolved" to remove from dashboard

---

## Files Created

```
NEW:
├── supabase/migrations/
│   └── 034_duplicate_leads_constraints.sql
├── lib/
│   └── duplicate-leads-cleanup.ts
├── app/api/admin/
│   └── find-duplicates/route.ts
├── components/admin/
│   └── DuplicateLeadsManager.tsx
├── app/(dashboard)/admin/
│   └── duplicates/page.tsx
├── docs/
│   └── DUPLICATE_LEADS_CLEANUP.md
└── DUPLICATE_LEADS_SETUP.md (this file)

EXISTING (Enhanced):
├── components/leads/LeadForm.tsx (already has duplicate check)
```

---

## How to Use Each Tool

### Option A: Admin Dashboard (Easiest)

```
URL: http://localhost:3000/admin/duplicates
Access: Admin users only
Actions: Review, compare, mark as resolved
```

### Option B: API Endpoint (Programmatic)

```bash
# Just report (no database changes):
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/admin/find-duplicates

# Find and flag for review:
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/admin/find-duplicates?action=flag"
```

### Option C: Direct SQL Query (Advanced)

```sql
-- Find duplicates in database
SELECT 
  l1.id as primary_id, l1.company_name as primary,
  l2.id as dup_id, l2.company_name as duplicate,
  'phone' as reason, l1.phone
FROM leads l1
JOIN leads l2 ON LOWER(l1.phone) = LOWER(l2.phone)
WHERE l1.phone IS NOT NULL
  AND l1.created_at < l2.created_at
  AND l1.id != l2.id;
```

---

## Key Features

✅ **Prevents Future Duplicates**
- Form validation on create
- Database unique constraints

✅ **Finds Existing Duplicates**
- Comprehensive scan
- Multiple matching criteria (phone, email, company)

✅ **Admin Dashboard**
- Visual comparison
- Direct lead links
- Mark as resolved

✅ **Tracking**
- All duplicates logged in `duplicate_lead_records`
- Merge history preserved
- Audit trail

---

## For Developers

### Core Library: `duplicate-leads-cleanup.ts`

Three main functions:

```typescript
// Find all duplicates
const report = await findDuplicateLeads(supabase)
// Returns: { totalLeads, duplicatePairs, summary }

// Flag them in the database
const result = await flagDuplicatesForReview(supabase, report.duplicatePairs)
// Returns: { flagged, skipped }

// Generate readable report
const text = generateDuplicateReport(report)
// Returns: formatted string
```

### Add Duplicate Detection to Custom UI

```typescript
import { findDuplicateLeads } from '@/lib/duplicate-leads-cleanup'

const report = await findDuplicateLeads(supabase)
console.log(`Found ${report.summary.totalDuplicates} duplicates`)
```

---

## Troubleshooting

### "Admin access required" error
- Only admins can access `/admin/duplicates` and the API
- Check user role in database: `profiles.role = 'admin'`

### Scan finds fewer duplicates than expected
- Form validation prevents creation of obvious duplicates
- Company name matching is case-insensitive but exact
- Variations like spaces/dashes in phone won't match
- Very old duplicates from before validation was added should still show

### Migration fails
- Check if constraints already exist from previous run
- SQL uses `IF NOT EXISTS` so it's safe to re-run
- Check Supabase logs for specific error

### "Constraint violation" when updating leads
- A phone or email is duplicated
- Use the admin dashboard to resolve first
- Or temporarily disable constraint: `ALTER INDEX idx_leads_phone_unique UNUSABLE;`

---

## Next Steps

1. ✅ Run migration: `supabase migration up`
2. ✅ Visit `/admin/duplicates`
3. ✅ Click "Scan for New Duplicates"
4. ✅ Review and resolve each pair
5. ✅ Test form validation with new leads

---

## Testing

### Test Form Prevention
1. Create lead with phone `+1234567890`
2. Try to create another with same phone
3. Should show: "Duplicate detected"

### Test Database Constraints
1. Admin Dashboard → Scan for duplicates
2. Manually insert duplicate via SQL
3. Database should reject with constraint error

### Test Cleanup Tool
1. Visit `/api/admin/find-duplicates`
2. Should return JSON report
3. Use `?action=flag` to save to database

---

## Questions?

See detailed docs: `docs/DUPLICATE_LEADS_CLEANUP.md`

Contact: This system is fully documented in code comments.
