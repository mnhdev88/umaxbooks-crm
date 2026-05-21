# Duplicate Leads Detection & Cleanup Guide

## Overview

This system prevents and manages duplicate leads in the UMAX CRM. It includes:
- **Automatic detection** of duplicates when creating new leads
- **Database constraints** to prevent new duplicates
- **Cleanup tool** to find and flag existing duplicates
- **Admin dashboard** to review and resolve duplicates

## How It Works

### 1. Prevention (Automatic)

When creating a **new lead**, the system automatically checks for duplicates by:
- **Phone number** (exact match, case-insensitive)
- **Email address** (exact match, case-insensitive)
- **Company name** (case-insensitive partial match)

If a duplicate is found, the form is blocked with a message showing the existing lead. This prevents future duplicates from being created.

**Status**: ✅ Live in `LeadForm.tsx`

### 2. Database Constraints

The migration `034_duplicate_leads_constraints.sql` adds:

#### Unique Indexes (Partial)
```sql
CREATE UNIQUE INDEX idx_leads_phone_unique
  ON leads(LOWER(phone))
  WHERE phone IS NOT NULL AND phone != '';

CREATE UNIQUE INDEX idx_leads_email_unique
  ON leads(LOWER(email))
  WHERE email IS NOT NULL AND email != '';
```

These prevent the database layer from accepting duplicate phone/email values, even if the application layer is bypassed.

#### Tracking Table
```sql
CREATE TABLE duplicate_lead_records (
  primary_lead_id UUID,      -- The original/primary lead
  duplicate_lead_id UUID,    -- The newer/duplicate lead
  duplicate_reason TEXT,     -- 'phone', 'email', 'company_name'
  status TEXT,               -- 'flagged', 'merged', 'manual_review'
  notes TEXT,
  created_at TIMESTAMPTZ,
  merged_at TIMESTAMPTZ,
  merged_by UUID
);
```

#### Lead Tracking Columns
```sql
ALTER TABLE leads ADD COLUMN is_merged BOOLEAN DEFAULT FALSE;
ALTER TABLE leads ADD COLUMN merged_into_id UUID;
```

### 3. Finding Existing Duplicates

#### Option A: API Endpoint (Headless)

**Report only (no changes):**
```bash
GET /api/admin/find-duplicates
```

Response:
```json
{
  "success": true,
  "report": {
    "totalLeads": 500,
    "duplicatePairs": [
      {
        "primaryLeadId": "uuid-1",
        "primaryLeadName": "Invierta Group",
        "duplicateLeadId": "uuid-2",
        "duplicateLeadName": "Invierta Group",
        "duplicateReason": "phone",
        "matchedValue": "+1234567890"
      }
    ],
    "summary": {
      "phoneMatches": 3,
      "emailMatches": 2,
      "companyNameMatches": 1,
      "totalDuplicates": 6
    }
  },
  "textReport": "╔═══════════════════════════════════╗\n║ DUPLICATE LEADS CLEANUP REPORT ║\n..."
}
```

**Flag for review (saves to database):**
```bash
GET /api/admin/find-duplicates?action=flag
```

This will:
1. Find all duplicates
2. Insert records into `duplicate_lead_records` table
3. Mark them with status `'flagged'`
4. Return count of flagged pairs

#### Option B: Admin Dashboard

Navigate to: `/admin/duplicates`

This page shows:
- All flagged duplicate pairs
- Side-by-side comparison of primary vs. duplicate
- Lead details (phone, email, creation date)
- Direct links to edit leads
- Buttons to mark as resolved or flag for manual review

### 4. Resolving Duplicates

#### Two Paths

**Path 1: Keep Primary + Delete Duplicate**
1. Review the pair on the admin dashboard
2. Open both leads in new tabs
3. Copy any unique data from the duplicate lead to primary
4. Delete the duplicate lead
5. Click "Resolved" on the dashboard

**Path 2: Merge Both**
1. Review the pair
2. Consolidate all unique information into one lead
3. Update all related records (appointments, audits, etc.) to point to the kept lead
4. Delete the other lead
5. Click "Resolved"

#### Database Updates

Before deleting a lead, ensure related records are updated:

```sql
-- Move all records from duplicate lead to primary lead
UPDATE appointments 
SET lead_id = 'primary-id' 
WHERE lead_id = 'duplicate-id';

UPDATE audits 
SET lead_id = 'primary-id' 
WHERE lead_id = 'duplicate-id';

UPDATE deals 
SET lead_id = 'primary-id' 
WHERE lead_id = 'duplicate-id';

-- Then delete the duplicate
DELETE FROM leads WHERE id = 'duplicate-id';
```

### 5. Checking for Duplicates

#### After Creating Many Leads

1. Go to `/admin/duplicates`
2. Click "Scan for New Duplicates"
3. Review any flagged pairs
4. Resolve them

#### Bulk CSV Import

If you imported leads from CSV/Excel, run the scan immediately after import to find duplicates that may have slipped through.

## API Reference

### GET /api/admin/find-duplicates

**Authentication**: Admin only

**Query Parameters**:
- `action` (optional): `'report'` (default) or `'flag'`

**Response**:
```json
{
  "success": boolean,
  "report": {
    "totalLeads": number,
    "duplicatePairs": DuplicateLeadPair[],
    "summary": {
      "phoneMatches": number,
      "emailMatches": number,
      "companyNameMatches": number,
      "totalDuplicates": number
    }
  },
  "flagResult": {
    "flagged": number,
    "skipped": number
  },
  "textReport": string,
  "message": string
}
```

## Implementation Details

### Files Added

```
lib/
  duplicate-leads-cleanup.ts       # Core detection logic

app/api/admin/
  find-duplicates/route.ts         # API endpoint

components/admin/
  DuplicateLeadsManager.tsx        # Admin UI component

app/(dashboard)/admin/
  duplicates/page.tsx              # Admin page

supabase/migrations/
  034_duplicate_leads_constraints.sql  # Database constraints

docs/
  DUPLICATE_LEADS_CLEANUP.md       # This file
```

### Key Functions

#### `findDuplicateLeads(supabase)`
Scans entire leads table and returns all duplicate pairs grouped by:
- Phone matches
- Email matches
- Company name matches

Keeps the oldest lead as "primary" and flags newer ones as "duplicates".

#### `flagDuplicatesForReview(supabase, pairs)`
Inserts duplicate records into the database for tracking.

#### `generateDuplicateReport(report)`
Creates a human-readable text report.

## Testing

### Verify Prevention Works

1. Create a lead with phone `+1234567890`
2. Try to create another lead with the same phone
3. Should see: "Duplicate detected — a lead with this phone number already exists"

### Verify Constraints Work

1. Try to directly insert duplicate via SQL/API (bypass form)
2. Database should reject with unique constraint error

### Test Cleanup Tool

1. Go to `/api/admin/find-duplicates`
2. Should return JSON report of any duplicates
3. Use `?action=flag` to save to database

## Troubleshooting

### "Duplicate detected" but I want to allow it

Check if the phone/email is really different:
- Remove spaces, dashes: `+1 (234) 567-8900` vs `+12345678900`
- Check email: `john@example.com` vs `john+test@example.com`
- Consider if company name is truly identical (case, spacing, special chars)

### Scan finds no duplicates but I see obvious ones

Reason: The duplicates were created before the form validation was added.

Solution: Go to `/admin/duplicates` and click "Scan for New Duplicates" to run the comprehensive cleanup tool.

### Migration failed on initial run

Reason: Existing duplicates conflict with new unique constraints.

Solution:
1. Run the cleanup tool first: `/api/admin/find-duplicates?action=flag`
2. Manually resolve duplicates
3. Then run migration

## Future Enhancements

- [ ] Fuzzy matching for similar company names
- [ ] One-click merge button (auto-consolidate all data)
- [ ] Bulk delete for confirmed duplicates
- [ ] Email/SMS notifications when duplicates found
- [ ] Machine learning to detect near-duplicates
- [ ] Import validation to catch duplicates before they're added

## Related Code

- **Form Prevention**: [LeadForm.tsx](../components/leads/LeadForm.tsx#L210-L234)
- **Database Schema**: [001_initial_schema.sql](../supabase/migrations/001_initial_schema.sql)
- **Constraints**: [034_duplicate_leads_constraints.sql](../supabase/migrations/034_duplicate_leads_constraints.sql)
