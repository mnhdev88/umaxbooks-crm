import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { findDuplicateLeads, flagDuplicatesForReview, generateDuplicateReport } from '@/lib/duplicate-leads-cleanup'

/**
 * GET /api/admin/find-duplicates
 *
 * Finds all duplicate leads in the database and flags them for review.
 * Admin only endpoint. Returns a detailed report.
 *
 * Query params:
 *   - action: 'report' (default) or 'flag' - report only vs. also flag in database
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()

    // Check auth
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const action = req.nextUrl.searchParams.get('action') || 'report'

    // Find duplicates
    const report = await findDuplicateLeads(supabase)

    // Flag them if requested
    let flagResult = null
    if (action === 'flag') {
      flagResult = await flagDuplicatesForReview(supabase, report.duplicatePairs)
    }

    // Generate readable report
    const textReport = generateDuplicateReport(report)

    return NextResponse.json(
      {
        success: true,
        report,
        flagResult,
        textReport,
        message: action === 'flag'
          ? `Found ${report.summary.totalDuplicates} duplicates. Flagged ${flagResult?.flagged} pairs for review.`
          : `Found ${report.summary.totalDuplicates} duplicates. Use ?action=flag to save to database.`,
      },
      { status: 200 }
    )
  } catch (err: any) {
    console.error('Duplicate detection error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to find duplicates' },
      { status: 500 }
    )
  }
}
