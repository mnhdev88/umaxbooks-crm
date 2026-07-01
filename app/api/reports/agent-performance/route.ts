import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveReportingRange } from '@/lib/reporting-day'
import { getReportDayConfig } from '@/lib/report-config'

// On-demand CSV download of the per-agent performance report. Admin-only, runs
// under the caller's session. Reuses the report_user_kpis aggregate (counts done
// in SQL, so nothing is capped at PostgREST's 1000-row limit). Accepts the same
// optional ?from=&to= range as the Reports page; with neither it's all-time.

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const from = req.nextUrl.searchParams.get('from') || undefined
  const to   = req.nextUrl.searchParams.get('to') || undefined
  const agentParam = req.nextUrl.searchParams.get('agent') || undefined
  const dayCfg = await getReportDayConfig(supabase)
  const { fromISO, toISO } = resolveReportingRange(from, to, dayCfg)

  // No `agent` → whole-team report (Team page). With `agent` → just that one
  // (agent profile page), still scoped to agent/sales_agent roles.
  let agentsQ = supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['agent', 'sales_agent'])
  if (agentParam) agentsQ = agentsQ.eq('id', agentParam)
  const { data: agents } = await agentsQ.order('full_name')

  const list = agents || []
  const { data: rows } = await supabase.rpc('report_user_kpis', {
    user_ids: list.map(a => a.id),
    from_ts: fromISO ?? null,
    to_ts: toISO ?? null,
  })
  const byId = new Map((rows ?? []).map((r: any) => [r.user_id, r]))

  const header = [
    'Agent', 'Email', 'Role', 'Leads Added', 'Leads Assigned',
    'Leads Completed', 'Demos Booked', 'Deals Closed', 'Revenue', 'Conversion %',
  ]
  const lines = [header.map(csvCell).join(',')]

  for (const a of list) {
    const r: any = byId.get(a.id)
    const assigned = Number(r?.leads_assigned ?? 0)
    const closed   = Number(r?.deals_closed ?? 0)
    const conv = assigned > 0 ? Math.round((closed / assigned) * 1000) / 10 : 0
    lines.push([
      a.full_name || a.email,
      a.email,
      String(a.role).replace('_', ' '),
      Number(r?.leads_added ?? 0),
      assigned,
      Number(r?.leads_completed ?? 0),
      Number(r?.demos_booked ?? 0),
      closed,
      Number(r?.revenue ?? 0),
      conv,
    ].map(csvCell).join(','))
  }

  const csv = lines.join('\n')
  const rangeSlug = (from || to) ? [from, to].filter(Boolean).join('_') : 'all-time'
  const namePart = agentParam && list[0]?.full_name
    ? list[0].full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '_'
    : ''

  // BOM so Excel reads UTF-8 correctly.
  return new Response('﻿' + csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="agent-performance_${namePart}${rangeSlug}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
