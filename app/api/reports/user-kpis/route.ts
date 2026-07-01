import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveReportingRange, reportingDate, reportingDayWindow, type ReportDayConfig } from '@/lib/reporting-day'
import { getReportDayConfig } from '@/lib/report-config'

// Preset windows anchored to the business reporting day (start hour + timezone),
// so 'today' means the current shift's day — not server-local midnight.
function periodStart(period: string, cfg: ReportDayConfig): string | null {
  const now = new Date()
  if (period === 'today') { return reportingDayWindow(reportingDate(now, cfg), cfg).fromISO }
  if (period === '7d')    { const d = new Date(now); d.setDate(d.getDate() - 7);  return d.toISOString() }
  if (period === '30d')   { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString() }
  if (period === 'month') { return new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }
  return null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!myProfile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Prefer an explicit calendar range (from/to); fall back to legacy `period`.
  const from = req.nextUrl.searchParams.get('from') || undefined
  const to   = req.nextUrl.searchParams.get('to') || undefined
  const period = req.nextUrl.searchParams.get('period') || 'month'
  const hasRange = Boolean(from || to)
  const dayCfg = await getReportDayConfig(supabase)
  const range = resolveReportingRange(from, to, dayCfg)
  const start = hasRange ? range.fromISO : periodStart(period, dayCfg)
  const end   = hasRange ? range.toISO : null
  const isAdmin = myProfile.role === 'admin'

  // Which users to show
  const { data: allUsers } = isAdmin
    ? await supabase.from('profiles').select('id, full_name, role').in('role', ['agent', 'sales_agent']).order('full_name')
    : await supabase.from('profiles').select('id, full_name, role').eq('id', user.id)

  if (!allUsers?.length) return NextResponse.json({ kpis: [] })

  const userIds = allUsers.map(u => u.id)

  // Aggregate every KPI in SQL (one call) so counts aren't capped at PostgREST's
  // 1000-row limit the way fetching rows + counting in JS was.
  const { data: rows } = await supabase.rpc('report_user_kpis', {
    user_ids: userIds,
    from_ts: start ?? null,
    to_ts: end ?? null,
  })
  const byId = new Map((rows ?? []).map((r: any) => [r.user_id, r]))

  const kpis = allUsers.map(u => {
    const r: any = byId.get(u.id)
    return {
      id: u.id,
      full_name: u.full_name,
      role: u.role,
      leads_added:     Number(r?.leads_added ?? 0),
      leads_assigned:  Number(r?.leads_assigned ?? 0),
      leads_completed: Number(r?.leads_completed ?? 0),
      demos_booked:    Number(r?.demos_booked ?? 0),
      deals_closed:    Number(r?.deals_closed ?? 0),
      revenue:         Number(r?.revenue ?? 0),
    }
  })

  return NextResponse.json({ kpis })
}
