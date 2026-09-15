import { NextRequest, NextResponse } from 'next/server'
import { requireSeoUser } from '@/lib/seo/guard'
import { upsertDraftReport, monthBounds, previousMonthBounds, buildReportData } from '@/lib/seo/report'

// Build (or refresh) a draft report for a site. Called by the "Generate report"
// button; the monthly cron does the same thing unattended.
//
// `period` is a YYYY-MM-DD inside the month wanted. Omit it for last month —
// the month you'd actually report on, since the current one isn't over.

export async function POST(req: NextRequest) {
  const guard = await requireSeoUser()
  if (guard.error) return guard.error
  const { supabase } = guard

  const { siteId, period } = await req.json().catch(() => ({} as any))
  if (!siteId) return NextResponse.json({ error: 'siteId required' }, { status: 400 })

  const { data: site } = await supabase
    .from('live_sites')
    .select('id, lead_id')
    .eq('id', siteId)
    .maybeSingle()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const bounds = period
    ? monthBounds(new Date(`${period}T00:00:00Z`))
    : previousMonthBounds(new Date())

  const result = await upsertDraftReport(supabase, site as any, bounds.start, bounds.end, 'manual')
  if (!result) {
    return NextResponse.json({ error: 'Could not build a report for that period' }, { status: 400 })
  }
  if (result.status === 'sent') {
    return NextResponse.json(
      { error: 'That month has already been sent to the client.', reportId: result.id },
      { status: 409 }
    )
  }

  const data = await buildReportData(supabase, site.id, bounds.start, bounds.end)
  return NextResponse.json({ reportId: result.id, period: bounds, data })
}
