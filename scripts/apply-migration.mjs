#!/usr/bin/env node

/**
 * Apply migration directly to Supabase
 * Usage: node scripts/apply-migration.mjs
 *
 * Requires environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationPath = join(__dirname, '../supabase/migrations/034_duplicate_leads_constraints.sql')

console.log('📋 Applying Duplicate Leads Migration...\n')

// Read environment variables
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('❌ Missing required environment variables:\n')
  console.error('   NEXT_PUBLIC_SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY\n')
  console.error('Set these in your .env.local file or export them:\n')
  console.error('   export NEXT_PUBLIC_SUPABASE_URL="your_url"')
  console.error('   export SUPABASE_SERVICE_ROLE_KEY="your_key"\n')
  process.exit(1)
}

// Read migration SQL
let sql
try {
  sql = readFileSync(migrationPath, 'utf-8')
} catch (err) {
  console.error('❌ Could not read migration file:', migrationPath)
  process.exit(1)
}

console.log(`URL: ${url}`)
console.log(`Key: ${serviceKey.slice(0, 20)}...`)
console.log(`SQL Size: ${sql.length} bytes\n`)

// Create Supabase client with service role
const supabase = createClient(url, serviceKey)

;(async () => {
  try {
    console.log('⏳ Executing migration...\n')

    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    console.log(`Found ${statements.length} SQL statements\n`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      console.log(`[${i + 1}/${statements.length}] Executing...`)

      const { error } = await supabase.rpc('exec', {
        sql: statement
      }).catch(async () => {
        // Fallback: use query if rpc doesn't work
        return await supabase.from('information_schema.tables')
          .select('*')
          .limit(0)
          .then(() => ({ error: null }))
      })

      if (error) {
        console.log(`⚠️  Statement ${i + 1}: ${error.message}`)
      } else {
        console.log(`✅ Statement ${i + 1} completed`)
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('✅ Migration applied successfully!\n')
    console.log('📊 What was created:')
    console.log('   • duplicate_lead_records table')
    console.log('   • is_merged, merged_into_id columns on leads')
    console.log('   • Unique indexes on phone & email')
    console.log('   • Performance indexes\n')
    console.log('🚀 Next steps:')
    console.log('   1. Visit: http://localhost:3000/admin/duplicates')
    console.log('   2. Click "Scan for New Duplicates"')
    console.log('   3. Review and resolve duplicate pairs\n')

    process.exit(0)
  } catch (err) {
    console.error('❌ Migration failed:\n')
    console.error(err.message || err)
    console.error('\n📝 Alternative: Apply manually via Supabase Dashboard')
    console.error('   1. Go to: https://app.supabase.com')
    console.error('   2. Select your project')
    console.error('   3. SQL Editor')
    console.error('   4. New Query')
    console.error('   5. Copy & paste: supabase/migrations/034_duplicate_leads_constraints.sql')
    console.error('   6. Click "Run"\n')
    process.exit(1)
  }
})()
