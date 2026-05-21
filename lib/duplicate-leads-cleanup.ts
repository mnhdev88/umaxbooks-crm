import { SupabaseClient } from '@supabase/supabase-js'

export interface DuplicateLeadPair {
  primaryLeadId: string
  primaryLeadName: string
  duplicateLeadId: string
  duplicateLeadName: string
  duplicateReason: 'phone' | 'email' | 'company_name'
  matchedValue: string
  primaryCreatedAt: string
  duplicateCreatedAt: string
}

export interface DuplicateCleanupReport {
  totalLeads: number
  duplicatePairs: DuplicateLeadPair[]
  summary: {
    phoneMatches: number
    emailMatches: number
    companyNameMatches: number
    totalDuplicates: number
  }
}

/**
 * Find all duplicate leads in the database
 * Returns older leads marked as primary, newer duplicates flagged for review
 */
export async function findDuplicateLeads(
  supabase: SupabaseClient
): Promise<DuplicateCleanupReport> {
  const { data: allLeads, error } = await supabase
    .from('leads')
    .select('id, name, company_name, phone, email, created_at')
    .order('created_at', { ascending: true })

  if (error) throw error
  if (!allLeads?.length) return { totalLeads: 0, duplicatePairs: [], summary: { phoneMatches: 0, emailMatches: 0, companyNameMatches: 0, totalDuplicates: 0 } }

  const duplicatePairs: DuplicateLeadPair[] = []
  const seen = new Map<string, { id: string; name: string; createdAt: string }[]>()

  // Group by phone
  for (const lead of allLeads) {
    if (lead.phone?.trim()) {
      const key = `phone:${lead.phone.trim().toLowerCase()}`
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push({ id: lead.id, name: lead.company_name, createdAt: lead.created_at })
    }
  }

  // Find phone duplicates (keep oldest, flag newer)
  for (const [key, leads] of seen.entries()) {
    if (leads.length > 1) {
      for (let i = 1; i < leads.length; i++) {
        const primary = allLeads.find(l => l.id === leads[0].id)!
        const duplicate = allLeads.find(l => l.id === leads[i].id)!
        duplicatePairs.push({
          primaryLeadId: primary.id,
          primaryLeadName: primary.company_name,
          duplicateLeadId: duplicate.id,
          duplicateLeadName: duplicate.company_name,
          duplicateReason: 'phone',
          matchedValue: primary.phone,
          primaryCreatedAt: primary.created_at,
          duplicateCreatedAt: duplicate.created_at,
        })
      }
    }
  }

  seen.clear()

  // Group by email
  for (const lead of allLeads) {
    if (lead.email?.trim()) {
      const key = `email:${lead.email.trim().toLowerCase()}`
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push({ id: lead.id, name: lead.company_name, createdAt: lead.created_at })
    }
  }

  // Find email duplicates
  for (const [key, leads] of seen.entries()) {
    if (leads.length > 1) {
      for (let i = 1; i < leads.length; i++) {
        const primary = allLeads.find(l => l.id === leads[0].id)!
        const duplicate = allLeads.find(l => l.id === leads[i].id)!
        // Avoid adding same pair twice if already found by phone
        if (!duplicatePairs.some(p => p.primaryLeadId === primary.id && p.duplicateLeadId === duplicate.id)) {
          duplicatePairs.push({
            primaryLeadId: primary.id,
            primaryLeadName: primary.company_name,
            duplicateLeadId: duplicate.id,
            duplicateLeadName: duplicate.company_name,
            duplicateReason: 'email',
            matchedValue: primary.email,
            primaryCreatedAt: primary.created_at,
            duplicateCreatedAt: duplicate.created_at,
          })
        }
      }
    }
  }

  seen.clear()

  // Group by company name (case-insensitive)
  for (const lead of allLeads) {
    if (lead.company_name?.trim()) {
      const key = `company:${lead.company_name.trim().toLowerCase()}`
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key)!.push({ id: lead.id, name: lead.company_name, createdAt: lead.created_at })
    }
  }

  // Find company name duplicates
  for (const [key, leads] of seen.entries()) {
    if (leads.length > 1) {
      for (let i = 1; i < leads.length; i++) {
        const primary = allLeads.find(l => l.id === leads[0].id)!
        const duplicate = allLeads.find(l => l.id === leads[i].id)!
        // Avoid adding same pair twice
        if (!duplicatePairs.some(p => p.primaryLeadId === primary.id && p.duplicateLeadId === duplicate.id)) {
          duplicatePairs.push({
            primaryLeadId: primary.id,
            primaryLeadName: primary.company_name,
            duplicateLeadId: duplicate.id,
            duplicateLeadName: duplicate.company_name,
            duplicateReason: 'company_name',
            matchedValue: primary.company_name,
            primaryCreatedAt: primary.created_at,
            duplicateCreatedAt: duplicate.created_at,
          })
        }
      }
    }
  }

  const summary = {
    phoneMatches: duplicatePairs.filter(p => p.duplicateReason === 'phone').length,
    emailMatches: duplicatePairs.filter(p => p.duplicateReason === 'email').length,
    companyNameMatches: duplicatePairs.filter(p => p.duplicateReason === 'company_name').length,
    totalDuplicates: duplicatePairs.length,
  }

  return {
    totalLeads: allLeads.length,
    duplicatePairs,
    summary,
  }
}

/**
 * Flag all found duplicates in the database for admin review
 */
export async function flagDuplicatesForReview(
  supabase: SupabaseClient,
  duplicatePairs: DuplicateLeadPair[]
): Promise<{ flagged: number; skipped: number }> {
  let flagged = 0
  let skipped = 0

  for (const pair of duplicatePairs) {
    // Upsert: insert or re-flag if previously marked merged/manual_review
    const { error } = await supabase
      .from('duplicate_lead_records')
      .upsert(
        {
          primary_lead_id: pair.primaryLeadId,
          duplicate_lead_id: pair.duplicateLeadId,
          duplicate_reason: pair.duplicateReason,
          status: 'flagged',
          notes: `Auto-detected ${pair.duplicateReason} match: ${pair.matchedValue}`,
          merged_at: null,
        },
        { onConflict: 'primary_lead_id,duplicate_lead_id' }
      )

    if (error) {
      console.error(`Failed to flag duplicate pair: ${error.message}`)
    } else {
      flagged++
    }
  }

  return { flagged, skipped }
}

/**
 * Generate a human-readable report
 */
export function generateDuplicateReport(report: DuplicateCleanupReport): string {
  let output = `
╔══════════════════════════════════════════════════════════╗
║          DUPLICATE LEADS CLEANUP REPORT                  ║
╚══════════════════════════════════════════════════════════╝

📊 SUMMARY
──────────────────────────────────────────────────────────
Total Leads: ${report.totalLeads}
Duplicate Pairs Found: ${report.summary.totalDuplicates}

By Type:
  • Phone Number Matches: ${report.summary.phoneMatches}
  • Email Matches: ${report.summary.emailMatches}
  • Company Name Matches: ${report.summary.companyNameMatches}

`

  if (report.duplicatePairs.length === 0) {
    output += '✅ No duplicates found!\n'
    return output
  }

  output += `
DUPLICATE PAIRS REQUIRING REVIEW
──────────────────────────────────────────────────────────

`

  report.duplicatePairs.forEach((pair, index) => {
    output += `${index + 1}. ${pair.duplicateReason.toUpperCase()} MATCH
   Primary:   [${pair.primaryLeadId.slice(0, 8)}...] ${pair.primaryLeadName} (${pair.primaryCreatedAt.split('T')[0]})
   Duplicate: [${pair.duplicateLeadId.slice(0, 8)}...] ${pair.duplicateLeadName} (${pair.duplicateCreatedAt.split('T')[0]})
   Matched:   ${pair.matchedValue}

`
  })

  output += `
NEXT STEPS
──────────────────────────────────────────────────────────
1. All duplicates have been flagged in the database
2. Review each pair in the admin panel
3. Decide which lead is primary and which to merge/delete
4. Update associated records before deleting

`

  return output
}
