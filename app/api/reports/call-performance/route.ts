import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveReportingRange } from '@/lib/reporting-day'
import { getReportDayConfig } from '@/lib/report-config'
import { buildDialerReport } from '@/lib/dialer-report'

// Per-agent dialer-call performance for the in-app Call Performance dashboard.
//
// Authorization is decided from the caller's session (role + team), then the
// report is built with the service client scoped to exactly the callers they're
// allowed to see:
//   * admin / legacy 'agent' -> everyone (all sales agents + managers)
//   * sales_manager          -> themselves + their team (profiles.manager_id = them)
//   * sales_agent            -> themselves only
// (voice_calls SELECT is open to any authenticated user, so the scope MUST be
//  enforced here in the query, not by RLS.)
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const role = profile?.role
  if (!role || role === 'developer' || role === 'client') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve which callers this user may see.
  let agentIds: string[] | null = null // null = unscoped (everyone)
  if (role === 'sales_manager') {
    const { data: team } = await supabase.from('profiles').select('id').eq('manager_id', user.id)
    agentIds = [user.id, ...(team ?? []).map(t => t.id)]
  } else if (role !== 'admin' && role !== 'agent') {
    // sales_agent (and any other non-privileged sales role): self only.
    agentIds = [user.id]
  }

  const from = req.nextUrl.searchParams.get('from') || undefined
  const to = req.nextUrl.searchParams.get('to') || undefined
  const dayCfg = await getReportDayConfig(supabase)
  const { fromISO, toISO, label } = resolveReportingRange(from, to, dayCfg)

  // Daily call target (configurable in app_settings; default 50).
  const service = createServiceClient()
  const { data: targetRow } = await service
    .from('app_settings').select('value').eq('key', 'daily_call_target').single()
  const dailyTarget = Number(targetRow?.value) || 50

  // Target only makes sense over a bounded range — scale it by the number of
  // days. Open-ended/all-time ranges get no target (null).
  const DAY_MS = 86_400_000
  const days = fromISO && toISO
    ? Math.max(1, Math.round((new Date(toISO).getTime() - new Date(fromISO).getTime()) / DAY_MS))
    : null
  const effectiveTarget = days != null ? dailyTarget * days : null

  try {
    const report = await buildDialerReport(service, { fromISO, toISO, label, agentIds })
    return NextResponse.json({
      label,
      summary: report.summary,
      // Scoped exactly like `summary` — a sales_agent sees the numbers their own calls
      // went out on, not the pool's overall reputation.
      byNumber: report.by_number,
      dailyTarget,
      days,
      effectiveTarget,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
