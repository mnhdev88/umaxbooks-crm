# Applying the Duplicate Leads Migration

The migration file `034_duplicate_leads_constraints.sql` has been created but needs to be applied to your database.

## ⚡ Quick Start (Choose One)

### Option A: Supabase CLI (Recommended)

```bash
# Make sure you're in the project directory
cd "d:\downloads\Antigravity Projct\claude\umax-crm"

# Option 1: Push all pending migrations
supabase db push

# Option 2: List migrations to see status
supabase migration list

# Option 3: Push to production (if needed)
supabase db push --linked
```

### Option B: Supabase Dashboard (Easiest)

1. Go to: https://app.supabase.com
2. Select your project
3. Click **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy the entire contents of:
   ```
   supabase/migrations/034_duplicate_leads_constraints.sql
   ```
6. Paste into the editor
7. Click **Run** (or press Ctrl+Enter)
8. You should see: **"success"**

### Option C: Visual Studio Code

If you have the Supabase extension:
1. Open Command Palette (Ctrl+Shift+P)
2. Type: "Supabase: Execute SQL"
3. Paste migration SQL
4. Execute

### Option D: Direct SQL (Advanced)

If using `psql` directly:

```bash
psql -h your_host -U postgres -d postgres -f supabase/migrations/034_duplicate_leads_constraints.sql
```

---

## ✅ Verify It Worked

After applying, verify the migration was successful:

```sql
-- Check if new table exists
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables 
  WHERE table_name = 'duplicate_lead_records'
);
-- Should return: true

-- Check new columns on leads table
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'leads' AND column_name IN ('is_merged', 'merged_into_id');
-- Should return: is_merged, merged_into_id

-- Check new indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'leads' AND indexname LIKE 'idx_leads_%unique%';
-- Should return: idx_leads_phone_unique, idx_leads_email_unique
```

Or in Supabase Dashboard:
1. Go to **Database** → **Tables**
2. Look for `duplicate_lead_records` table
3. Open `leads` table
4. Scroll right to see `is_merged` and `merged_into_id` columns

---

## 🚀 Next Steps (After Migration Applied)

1. **Open the admin dashboard:**
   ```
   http://localhost:3000/admin/duplicates
   ```

2. **Log in as admin** (if not already)

3. **Click "Scan for New Duplicates"**
   - This will scan your entire leads database
   - Find all phone/email/company name matches
   - Flag them in the `duplicate_lead_records` table

4. **Review each duplicate pair:**
   - View side-by-side comparison
   - Click links to open the actual leads
   - Consolidate data as needed

5. **Resolve the duplicates:**
   - Delete the duplicate (newer) lead
   - Click "Resolved" on the dashboard
   - Record moved to `merged` status

---

## 🔍 Troubleshooting

### "Relation does not exist" error

**Problem:** Migration wasn't applied

**Solution:** Follow one of the options above to apply it

### "Permission denied" error

**Problem:** Using wrong API key or role

**Solution:**
- Use `SUPABASE_SERVICE_ROLE_KEY` (not anon key)
- Ensure your user is `admin` role in the `profiles` table

### "Unique constraint violation"

**Problem:** Duplicates exist that conflict with new constraints

**Solution:**
1. The migration uses `IF NOT EXISTS` so it won't fail
2. Run the dashboard scan to flag existing duplicates
3. Resolve them manually
4. Then apply the unique constraints if needed

### Dashboard shows "Table not found"

**Problem:** Migration applied but component not reloaded

**Solution:**
1. Hard refresh browser (Ctrl+Shift+R)
2. Clear browser cache
3. Or just wait a few seconds for Next.js to hot-reload

---

## 📊 What the Migration Does

### Creates New Table
```sql
duplicate_lead_records (
  primary_lead_id UUID,
  duplicate_lead_id UUID,
  duplicate_reason TEXT,
  status TEXT,
  notes TEXT,
  merged_at TIMESTAMPTZ,
  merged_by UUID
)
```

### Adds Columns to `leads` Table
- `is_merged BOOLEAN` — marks soft-deleted leads
- `merged_into_id UUID` — points to the lead it was merged into

### Adds Indexes
- `idx_leads_phone_unique` — unique phone constraint
- `idx_leads_email_unique` — unique email constraint
- `idx_leads_phone_lower` — case-insensitive phone search
- `idx_leads_email_lower` — case-insensitive email search

---

## 🆘 Still Stuck?

### Check Migration Status
```bash
# List all applied migrations
supabase migration list

# See if 034_duplicate_leads_constraints is listed
```

### Check Logs
```bash
# If using Supabase CLI locally
supabase logs
```

### Reset (Nuclear Option - USE WITH CAUTION)

If you need to start over:

```bash
# Reset local database
supabase db reset

# Then re-apply all migrations
supabase db push
```

**Warning:** This will erase all local data. Don't do this on production!

---

## 📞 Need Help?

1. Check the detailed docs: `docs/DUPLICATE_LEADS_CLEANUP.md`
2. Review the migration SQL: `supabase/migrations/034_duplicate_leads_constraints.sql`
3. Check browser console for detailed errors
4. Check Supabase dashboard logs
