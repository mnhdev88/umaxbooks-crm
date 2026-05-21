#!/usr/bin/env node

/**
 * Script to apply the duplicate leads migration
 * Usage: node scripts/apply-duplicate-migration.js
 */

const fs = require('fs')
const path = require('path')

console.log('📋 Duplicate Leads Migration Setup\n')

const migrationPath = path.join(__dirname, '../supabase/migrations/034_duplicate_leads_constraints.sql')
const setupPath = path.join(__dirname, '../DUPLICATE_LEADS_SETUP.md')

if (!fs.existsSync(migrationPath)) {
  console.error('❌ Migration file not found at:', migrationPath)
  process.exit(1)
}

const migration = fs.readFileSync(migrationPath, 'utf-8')

console.log('✅ Migration file found\n')
console.log('═══════════════════════════════════════════════════════════')
console.log('To apply this migration, choose one of the following:\n')

console.log('OPTION 1: Using Supabase CLI (Recommended)')
console.log('─────────────────────────────────────────')
console.log('  $ supabase migration up\n')

console.log('OPTION 2: Using Supabase Dashboard')
console.log('─────────────────────────────────────────')
console.log('  1. Go to: https://app.supabase.com')
console.log('  2. Select your project')
console.log('  3. SQL Editor')
console.log('  4. New Query')
console.log('  5. Copy & paste the SQL below')
console.log('  6. Click "Run"\n')

console.log('OPTION 3: Using Node.js (Direct)')
console.log('─────────────────────────────────────────')
console.log('  Create a .env.local file with:')
console.log('    NEXT_PUBLIC_SUPABASE_URL=your_url')
console.log('    SUPABASE_SERVICE_ROLE_KEY=your_key')
console.log('  Then run: node scripts/apply-duplicate-migration.js --execute\n')

console.log('═══════════════════════════════════════════════════════════')
console.log('\n📝 SQL to execute:\n')
console.log(migration)
console.log('\n═══════════════════════════════════════════════════════════\n')

if (process.argv.includes('--execute')) {
  console.log('🚀 Attempting to execute migration...\n')

  const { createClient } = require('@supabase/supabase-js')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error('❌ Missing environment variables:')
    console.error('   NEXT_PUBLIC_SUPABASE_URL')
    console.error('   SUPABASE_SERVICE_ROLE_KEY\n')
    process.exit(1)
  }

  const supabase = createClient(url, key)

  ;(async () => {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: migration })

      if (error) throw error

      console.log('✅ Migration applied successfully!\n')
      console.log('Next steps:')
      console.log('  1. Visit: http://localhost:3000/admin/duplicates')
      console.log('  2. Click "Scan for New Duplicates"')
      console.log('  3. Review and resolve any duplicate pairs\n')

      process.exit(0)
    } catch (err) {
      console.error('❌ Migration failed:', err.message, '\n')
      console.error('Fallback: Use Supabase Dashboard')
      console.error('Copy the SQL above and execute it manually in:')
      console.error('  https://app.supabase.com → SQL Editor\n')
      process.exit(1)
    }
  })()
} else {
  console.log('💡 Next steps:')
  console.log('  1. Choose one of the options above')
  console.log('  2. Apply the migration')
  console.log('  3. Verify it worked: npx supabase db list')
  console.log('  4. Visit: http://localhost:3000/admin/duplicates\n')
}
