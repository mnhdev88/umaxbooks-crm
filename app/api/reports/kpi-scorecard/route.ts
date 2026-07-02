import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveReportingRange } from '@/lib/reporting-day'
import { getReportDayConfig } from '@/lib/report-config'

// Weighted KPI Scorecard. Reuses the report_kpi_scorecard RPC for raw achieved
// numbers, then layers Target → Output % → Weighted score on top of the
// admin-editable kpi_scorecard_config, mirroring the Novelio KPI spreadsheet.
// Each user's config is kpi_scorecard_config with their rows from
// kpi_scorecard_user_overrides (075) merged in, so two agents can be graded
// against different targets/weights in the same report.
//
//   Output %      = achieved / effective_target × 100
//   Weighted      = weightage × min(Output %, 100) / 100
//   Total score   = Σ weighted   (0–100, since each Output % is capped at 100)
//
// We cap each KPI's Output % at 100 for the *score* so one over-performing metric
// can't push the grade past 100 — the raw (uncapped) Output % is still returned
// per row so over-performance stays visible.

const MONTH_MS = 1000 * 60 * 60 * 24

function monthFallbackStart(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}


// Whole days covered by [start, end); per_day targets scale by this. Min 1.
function dayCount(startISO: string | null, endISO: string | null): number {
  const start = startISO ? new Date(startISO).getTime() : null
  const end = endISO ? new Date(endISO).getTime() : Date.now()
  if (start === null) return 1 // all-time: treat per_day targets as a single period
  return Math.max(1, Math.round((end - start) / MONTH_MS))
}

interface ConfigRow {
  kpi_key: string
  stage: string
  label: string
  sort_order: number
  source: 'auto' | 'manual'
  unit: 'count' | 'hours' | 'percent'
  target: number | string
  target_basis: 'per_day' | 'per_period'
  weightage: number | string
  active: boolean
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: myProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!myProfile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isAdmin = myProfile.role === 'admin'

  const from = req.nextUrl.searchParams.get('from') || undefined
  const to   = req.nextUrl.searchParams.get('to') || undefined
  const hasRange = Boolean(from || to)
  const dayCfg = await getReportDayConfig(supabase)
  const range = resolveReportingRange(from, to, dayCfg)
  // Default (no range) = current month-to-date, matching the other KPI section.
  const start = hasRange ? range.fromISO : monthFallbackStart()
  const end   = hasRange ? range.toISO : null
  const days  = dayCount(start, end)

  // Which users to show: admins see the whole sales org, everyone else sees self.
  const { data: users } = isAdmin
    ? await supabase.from('profiles').select('id, full_name, role')
        .in('role', ['agent', 'sales_agent', 'sales_manager']).order('full_name')
    : await supabase.from('profiles').select('id, full_name, role').eq('id', user.id)

  // All config rows (not just active) — a per-user override can re-activate a
  // globally inactive KPI and vice versa. The returned `config`/`weightSum`
  // stay global-only, matching the Settings card.
  const { data: configRows } = await supabase
    .from('kpi_scorecard_config')
    .select('*')
    .order('sort_order')

  const allConfig = (configRows ?? []) as ConfigRow[]
  const config = allConfig.filter(c => c.active)
  const weightSum = config.reduce((s, c) => s + Number(c.weightage), 0)

  if (!users?.length || !allConfig.length) {
    return NextResponse.json({ agents: [], config, weightSum, days, weightOk: Math.round(weightSum) === 100 })
  }

  const userIds = users.map(u => u.id)

  const { data: overrideRows } = await supabase
    .from('kpi_scorecard_user_overrides')
    .select('user_id, kpi_key, target, weightage, active')
    .in('user_id', userIds)
  const overridesByUser = new Map<string, Map<string, { target: number; weightage: number; active: boolean }>>()
  for (const o of overrideRows ?? []) {
    if (!overridesByUser.has(o.user_id)) overridesByUser.set(o.user_id, new Map())
    overridesByUser.get(o.user_id)!.set(o.kpi_key, { target: Number(o.target), weightage: Number(o.weightage), active: o.active })
  }
  const { data: rawRows } = await supabase.rpc('report_kpi_scorecard', {
    user_ids: userIds,
    from_ts: start ?? null,
    to_ts: end ?? null,
  })
  const byId = new Map((rawRows ?? []).map((r: any) => [r.user_id, r]))

  // Map each raw RPC row onto the config KPIs by key.
  const achievedFor = (raw: any, key: string): number => {
    switch (key) {
      case 'leads_generated':     return Number(raw?.leads_generated ?? 0)
      case 'calls_made':          return Number(raw?.calls_made ?? 0)
      case 'talk_time_hrs':       return Number(raw?.talk_hrs ?? 0)
      case 'demos_given':         return Number(raw?.demos_given ?? 0)
      case 'deals_closed':        return Number(raw?.deals_closed ?? 0)
      case 'proposals_sent':      return Number(raw?.proposals_sent ?? 0)
      case 'training_completion': return Number(raw?.training_pct ?? 0)
      default:                    return 0
    }
  }

  const agents = users.map(u => {
    const raw = byId.get(u.id)
    const userOv = overridesByUser.get(u.id)
    const effConfig = allConfig
      .map(c => {
        const o = userOv?.get(c.kpi_key)
        return o
          ? { ...c, target: o.target, weightage: o.weightage, active: o.active, overridden: true }
          : { ...c, overridden: false }
      })
      .filter(c => c.active)
    const rows = effConfig.map(c => {
      const perDay = c.target_basis === 'per_day'
      const effTarget = perDay ? Number(c.target) * days : Number(c.target)
      const achieved = achievedFor(raw, c.kpi_key)
      const outputPct = effTarget > 0 ? (achieved / effTarget) * 100 : 0
      const weighted = (Number(c.weightage) * Math.min(outputPct, 100)) / 100
      return {
        kpi_key: c.kpi_key,
        stage: c.stage,
        label: c.label,
        unit: c.unit,
        source: c.source,
        target: Math.round(effTarget * 100) / 100,
        achieved: Math.round(achieved * 100) / 100,
        weightage: Number(c.weightage),
        outputPct: Math.round(outputPct * 10) / 10,
        weighted: Math.round(weighted * 10) / 10,
        overridden: c.overridden,
      }
    })
    const totalScore = Math.round(rows.reduce((s, r) => s + r.weighted, 0) * 10) / 10
    const userWeightSum = Math.round(effConfig.reduce((s, c) => s + Number(c.weightage), 0) * 10) / 10
    return {
      id: u.id, full_name: u.full_name, role: u.role, totalScore, rows,
      hasOverrides: Boolean(userOv?.size),
      weightSum: userWeightSum,
      weightOk: Math.round(userWeightSum) === 100,
    }
  }).sort((a, b) => b.totalScore - a.totalScore)

  return NextResponse.json({
    agents,
    config,
    weightSum: Math.round(weightSum * 10) / 10,
    weightOk: Math.round(weightSum) === 100,
    days,
  })
}
