import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, PIPELINE_STAGES } from '@/types'
import { STATUS_COLORS } from '@/lib/utils'
import { TrendingUp, Users, DollarSign, CheckCircle } from 'lucide-react'
import { UserKpiSection } from '@/components/reports/UserKpiSection'
import { ReportsDateFilter } from '@/components/reports/ReportsDateFilter'
import { DialerReportDownload } from '@/components/reports/DialerReportDownload'
import { resolveRange } from '@/lib/report-range'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { from, to } = await searchParams
  const { fromISO, toISO, label } = resolveRange(from, to)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role === 'developer') redirect('/')

  // Leads + deals filtered by created_at within the selected calendar range.
  // Counts/sums are aggregated in SQL (RPCs) so they aren't capped at PostgREST's
  // 1000-row limit the way fetching rows and counting in JS was.
  const [breakdownRes, revenueRes, agentsRes] = await Promise.all([
    supabase.rpc('report_lead_breakdown', { from_ts: fromISO ?? null, to_ts: toISO ?? null }),
    supabase.rpc('report_deal_revenue',   { from_ts: fromISO ?? null, to_ts: toISO ?? null }),
    supabase.from('profiles').select('id, full_name').in('role', ['agent', 'sales_agent']),
  ])

  const breakdown = (breakdownRes.data ?? []) as { status: string; assigned_agent_id: string | null; cnt: number | string }[]
  const agents = agentsRes.data
  const sumWhere = (pred: (r: { status: string; assigned_agent_id: string | null }) => boolean) =>
    breakdown.filter(pred).reduce((s, r) => s + Number(r.cnt), 0)

  const totalLeads = sumWhere(() => true)
  const wonLeads = sumWhere((r) => r.status === 'Closed Won')
  const completedLeads = sumWhere((r) => r.status === 'Completed')
  const lostLeads = sumWhere((r) => r.status === 'Lost')

  const revenue = (revenueRes.data?.[0] ?? null) as { total_revenue: number | string; paid_revenue: number | string } | null
  const totalRevenue = Number(revenue?.total_revenue ?? 0)
  const paidRevenue = Number(revenue?.paid_revenue ?? 0)

  const byStatus = PIPELINE_STAGES.reduce<Record<string, number>>((acc, stage) => {
    acc[stage] = sumWhere((r) => r.status === stage)
    return acc
  }, {})

  const agentPerformance = agents?.map((agent) => ({
    ...agent,
    total: sumWhere((r) => r.assigned_agent_id === agent.id),
    won: sumWhere((r) => r.assigned_agent_id === agent.id && r.status === 'Closed Won'),
  })).sort((a, b) => b.total - a.total)

  return (
    <>
      <Header title="Reports" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        {/* Calendar date-range filter — drives the whole page */}
        <ReportsDateFilter from={from} to={to} label={label} />

        {/* Per-agent dialer-call CSV export (admin only) */}
        {profile.role === 'admin' && (
          <div className="flex justify-end">
            <DialerReportDownload />
          </div>
        )}

        {/* Per-user KPI cards */}
        <UserKpiSection isAdmin={profile.role === 'admin'} from={from} to={to} />

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Leads', value: totalLeads, icon: Users, color: 'text-blue-400', bg: 'bg-blue-900/20' },
            { label: 'Closed Won', value: wonLeads, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-900/20' },
            { label: 'Total Revenue', value: `$${totalRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-orange-400', bg: 'bg-orange-900/20' },
            { label: 'Completed', value: completedLeads, icon: CheckCircle, color: 'text-teal-400', bg: 'bg-teal-900/20' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{kpi.label}</span>
                <div className={`w-8 h-8 rounded-lg ${kpi.bg} flex items-center justify-center`}>
                  <kpi.icon size={15} className={kpi.color} aria-hidden="true" />
                </div>
              </div>
              <p className="text-2xl font-bold text-slate-100 tabular-nums">{kpi.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pipeline breakdown */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Pipeline Breakdown</h3>
            <div className="space-y-2.5">
              {PIPELINE_STAGES.map((stage) => {
                const count = byStatus[stage] || 0
                const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0
                return (
                  <div key={stage} className="flex items-center gap-3" role="img" aria-label={`${stage}: ${count} leads, ${Math.round(pct)}%`}>
                    <span className="text-xs text-slate-400 w-32 truncate">{stage}</span>
                    <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400 w-12 text-right">{count} · {Math.round(pct)}%</span>
                  </div>
                )
              })}
              {lostLeads > 0 && (
                <div className="flex items-center gap-3" role="img" aria-label={`Lost: ${lostLeads} leads, ${Math.round((lostLeads / totalLeads) * 100)}%`}>
                  <span className="text-xs text-slate-400 w-32">Lost</span>
                  <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-red-600 rounded-full" style={{ width: `${(lostLeads / totalLeads) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-slate-400 w-12 text-right">{lostLeads} · {Math.round((lostLeads / totalLeads) * 100)}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Agent performance */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4">Agent Performance</h3>
            <div className="space-y-3">
              {agentPerformance?.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold">
                      {(agent.full_name ?? '?').charAt(0)}
                    </div>
                    <span className="text-sm text-slate-200">{agent.full_name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-slate-500">{agent.total} leads</span>
                    <span className="text-green-400 font-semibold">{agent.won} won</span>
                  </div>
                </div>
              ))}
              {!agentPerformance?.length && (
                <p className="text-sm text-slate-500 text-center py-4">No agent data</p>
              )}
            </div>
          </div>
        </div>

        {/* Revenue summary */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Revenue Summary</h3>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-slate-500 mb-1">Total Pipeline Value</p>
              <p className="text-xl font-bold text-orange-400">${totalRevenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Collected (Paid)</p>
              <p className="text-xl font-bold text-green-400">${paidRevenue.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Outstanding</p>
              <p className="text-xl font-bold text-yellow-400">${(totalRevenue - paidRevenue).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
