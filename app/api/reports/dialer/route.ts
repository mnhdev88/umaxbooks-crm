import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveReportingRange } from '@/lib/reporting-day'
import { getReportDayConfig } from '@/lib/report-config'
import { buildDialerReport, dialerReportToCSV } from '@/lib/dialer-report'

// On-demand CSV download of the per-sales-agent dialer-call report for the
// selected calendar range (?from=&to=, same params as the Reports page).
// Admin-only; runs under the caller's session.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || undefined
  const to = req.nextUrl.searchParams.get('to') || undefined
  const dayCfg = await getReportDayConfig(supabase)
  const { fromISO, toISO, label } = resolveReportingRange(from, to, dayCfg)

  try {
    const report = await buildDialerReport(supabase, { fromISO, toISO, label })
    const csv = dialerReportToCSV(report)
    const slug = (from || to)
      ? [from, to].filter(Boolean).join('_')
      : 'all-time'

    // BOM so Excel reads UTF-8 correctly.
    return new Response('﻿' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dialer-calls_${slug}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
