import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Profile, PIPELINE_STAGES } from '@/types'
import { STATUS_COLORS, timeAgo } from '@/lib/utils'
import { resolveRange } from '@/lib/report-range'
import { ReportsDateFilter } from '@/components/reports/ReportsDateFilter'
import { AgentPerformanceDownload } from '@/components/reports/AgentPerformanceDownload'
import {
  ArrowLeft, UserPlus, Users, Calendar, CheckCircle, Handshake, DollarSign, Activity,
} from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  admin:       'from-orange-500 to-orange-700',
  agent:       'from-blue-500 to-blue-700',
  sales_agent: 'from-purple-500 to-purple-700',
}

const TERMINAL = ['Completed', 'Lost', 'Disqualified']

interface PageProps {
  params: Promise<{ agentId: string }>
  searchParams: Promise<{ from?: string; to?: string }>
}

export default async function AgentProfilePage({ params, searchParams }: PageProps) {
  const supabase = await createClient()
  const { agentId } = await params
  const { from, to } = await searchParams
  const { fromISO, toISO, label } = resolveRange(from, to)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/')

  const { data: agent } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at')
    .eq('id', agentId)
    .single()
  if (!agent) redirect('/team')

  const notTerminal = `(${TERMINAL.map(s => `"${s}"`).join(',')})`

  // ── KPIs (respect the selected date range) ──────────────────────────────
  // Each metric is a head-count query so the 1000-row cap can't truncate it.
  const rangeCount = (
    table: string, column: string, build: (q: any) => any,
  ) => {
    let q = build(supabase.from(table).select('id', { count: 'exact', head: true }))
    if (fromISO) q = q.gte(column, fromISO)
    if (toISO) q = q.lt(column, toISO)
    return q
  }

  const [addedRes, completedRes, demosRes, assignedRes, dealsRes] = await Promise.all([
    rangeCount('activity_logs', 'created_at', q => q.eq('user_id', agentId).eq('action', 'Lead Created')),
    rangeCount('leads', 'updated_at', q => q.eq('assigned_agent_id', agentId).eq('status', 'Completed')),
    rangeCount('appointments', 'created_at', q => q.eq('created_by', agentId).not('appointment_datetime', 'is', null)),
    // Assigned is a current snapshot (assignment date isn't tracked), so no range.
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_agent_id', agentId),
    // Paid deals on this agent's leads, by payment date. Volume per agent/range is small.
    (() => {
      let q = supabase
        .from('deals')
        .select('final_payment_amount, leads!inner(assigned_agent_id)')
        .eq('payment_status', 'Paid')
        .eq('leads.assigned_agent_id', agentId)
      if (fromISO) q = q.gte('updated_at', fromISO)
      if (toISO) q = q.lt('updated_at', toISO)
      return q
    })(),
  ])

  const deals = (dealsRes.data as { final_payment_amount: number | null }[] | null) || []
  const revenue = deals.reduce((s, d) => s + (d.final_payment_amount || 0), 0)

  const kpis = [
    { icon: UserPlus,    label: 'Leads Added',  value: addedRes.count || 0,                 color: 'text-sky-400',    bg: 'bg-sky-900/30' },
    { icon: Users,       label: 'Assigned',     value: assignedRes.count || 0,              color: 'text-blue-400',   bg: 'bg-blue-900/30' },
    { icon: Calendar,    label: 'Demos Booked', value: demosRes.count || 0,                 color: 'text-purple-400', bg: 'bg-purple-900/30' },
    { icon: CheckCircle, label: 'Completed',    value: completedRes.count || 0,             color: 'text-teal-400',   bg: 'bg-teal-900/30' },
    { icon: Handshake,   label: 'Deals Closed', value: deals.length,                        color: 'text-green-400',  bg: 'bg-green-900/30' },
    { icon: DollarSign,  label: 'Revenue',      value: `$${revenue.toLocaleString()}`,      color: 'text-orange-400', bg: 'bg-orange-900/30' },
  ]

  // ── Current workload (a "right now" snapshot — not date-filtered) ────────
  const { data: openLeads } = await supabase
    .from('leads')
    .select('status')
    .eq('assigned_agent_id', agentId)
    .not('status', 'in', notTerminal)

  const byStage = PIPELINE_STAGES
    .filter(s => !TERMINAL.includes(s))
    .map(stage => ({ stage, count: openLeads?.filter(l => l.status === stage).length || 0 }))
    .filter(s => s.count > 0)
  const openTotal = openLeads?.length || 0

  // ── Recent activity ─────────────────────────────────────────────────────
  const { data: activity } = await supabase
    .from('activity_logs')
    .select('id, action, details, created_at, leads(id, company_name)')
    .eq('user_id', agentId)
    .order('created_at', { ascending: false })
    .limit(20)

  // ── Assigned leads (most recently touched) ──────────────────────────────
  const { data: assignedLeads } = await supabase
    .from('leads')
    .select('id, company_name, name, status, updated_at')
    .eq('assigned_agent_id', agentId)
    .order('updated_at', { ascending: false })
    .limit(50)

  return (
    <>
      <Header title="Agent Profile" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        <Link href="/team" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft size={14} aria-hidden="true" /> Back to Team
        </Link>

        {/* Agent identity */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center gap-4">
          <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${ROLE_COLORS[agent.role] || 'from-slate-500 to-slate-700'} flex items-center justify-center text-white text-xl font-bold shrink-0`}>
            {(agent.full_name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-100 truncate">{agent.full_name || agent.email}</h2>
            <p className="text-sm text-slate-400 truncate">{agent.email}</p>
            <p className="text-xs text-slate-500 mt-0.5 capitalize">{agent.role.replace('_', ' ')} · joined {timeAgo(agent.created_at)}</p>
          </div>
        </div>

        {/* Date range — drives the KPI cards below */}
        <ReportsDateFilter from={from} to={to} label={label} />

        {/* KPI cards */}
        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-sm font-semibold text-slate-200">Performance · <span className="text-slate-400 font-normal">{label}</span></h3>
            <AgentPerformanceDownload agentId={agent.id} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
                <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center mb-2`}>
                  <k.icon size={15} className={k.color} aria-hidden="true" />
                </div>
                <p className={`text-lg font-bold ${k.color} tabular-nums`}>{k.value}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Current workload */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-1">Current Workload</h3>
            <p className="text-xs text-slate-500 mb-4">{openTotal} open lead{openTotal === 1 ? '' : 's'} · live snapshot</p>
            {byStage.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No open leads.</p>
            ) : (
              <div className="space-y-2.5">
                {byStage.map(({ stage, count }) => {
                  const pct = openTotal > 0 ? (count / openTotal) * 100 : 0
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded w-32 shrink-0 truncate ${STATUS_COLORS[stage] || 'bg-slate-700 text-slate-200'}`}>{stage}</span>
                      <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono text-slate-400 w-6 text-right">{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Activity size={15} className="text-orange-400" aria-hidden="true" /> Recent Activity
            </h3>
            {!activity?.length ? (
              <p className="text-sm text-slate-500 text-center py-6">No activity logged.</p>
            ) : (
              <ol className="space-y-3">
                {activity.map((ev) => {
                  const leadRaw = ev.leads as any
                  const lead = (Array.isArray(leadRaw) ? leadRaw[0] : leadRaw) as { id: string; company_name: string | null } | null | undefined
                  return (
                    <li key={ev.id} className="flex gap-3 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 mt-1.5 shrink-0" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-slate-200">
                          <span className="font-medium">{ev.action}</span>
                          {lead && (
                            <> · <Link href={`/leads/${lead.id}`} className="text-orange-400 hover:underline">{lead.company_name || 'lead'}</Link></>
                          )}
                        </p>
                        {ev.details && <p className="text-xs text-slate-500 truncate">{ev.details}</p>}
                      </div>
                      <span className="text-[11px] text-slate-600 shrink-0">{timeAgo(ev.created_at)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </div>

        {/* Assigned leads */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-4">Assigned Leads <span className="text-slate-500 font-normal">({assignedLeads?.length || 0} most recent)</span></h3>
          {!assignedLeads?.length ? (
            <p className="text-sm text-slate-500 text-center py-6">No leads assigned.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                    <th className="pb-2 font-medium">Company</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {assignedLeads.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5">
                        <Link href={`/leads/${l.id}`} className="text-slate-200 hover:text-orange-400 transition-colors">
                          {l.company_name || l.name || '—'}
                        </Link>
                      </td>
                      <td className="py-2.5">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${STATUS_COLORS[l.status] || 'bg-slate-700 text-slate-200'}`}>{l.status}</span>
                      </td>
                      <td className="py-2.5 text-right text-xs text-slate-500">{timeAgo(l.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
