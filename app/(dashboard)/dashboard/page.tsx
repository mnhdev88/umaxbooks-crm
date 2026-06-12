import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, PIPELINE_STAGES } from '@/types'
import { ReportsDateFilter } from '@/components/reports/ReportsDateFilter'
import { resolveRange } from '@/lib/report-range'
import { Donut, HBars, RadialGauge, CountUp, type Slice } from '@/components/dashboard/charts'
import {
  Users, TrendingUp, DollarSign, Wallet, Percent,
  PhoneCall, MonitorPlay, FileSignature, Mail, LifeBuoy, Clock,
} from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>
}

interface ExecSummary {
  leads_by_status: Record<string, number>
  deals: { total_revenue: number; paid_revenue: number; count: number; by_status: Record<string, number> }
  demos_booked: number
  contracts_by_status: Record<string, number>
  calls: { total: number; completed: number; interested_yes: number; interested_maybe: number; interested_no: number; appointment_booked: number; do_not_call: number }
  emails_by_status: Record<string, number>
  support_by_status: Record<string, number>
  followups: { pending: number; overdue: number }
}

const EMPTY: ExecSummary = {
  leads_by_status: {},
  deals: { total_revenue: 0, paid_revenue: 0, count: 0, by_status: {} },
  demos_booked: 0,
  contracts_by_status: {},
  calls: { total: 0, completed: 0, interested_yes: 0, interested_maybe: 0, interested_no: 0, appointment_booked: 0, do_not_call: 0 },
  emails_by_status: {},
  support_by_status: {},
  followups: { pending: 0, overdue: 0 },
}

// Hex colors (Recharts uses inline SVG fills, so these are immune to light-mode class overrides).
const C: Record<string, string> = {
  New: '#64748b', Contacted: '#3b82f6', 'Audit Ready': '#a855f7', 'Callback Booked': '#06b6d4',
  'Demo Scheduled': '#eab308', 'Demo Done': '#f59e0b', 'Closed Won': '#22c55e', Revision: '#ec4899',
  Live: '#14b8a6', Completed: '#10b981', Lost: '#dc2626', Disqualified: '#475569',
  Paid: '#22c55e', Partial: '#eab308', Pending: '#64748b', Overdue: '#dc2626',
  delivered: '#22c55e', sent: '#3b82f6', scheduled: '#64748b', bounced: '#f97316', failed: '#dc2626', spam: '#db2777',
  interested_yes: '#22c55e', interested_maybe: '#eab308', interested_no: '#f97316', do_not_call: '#dc2626',
}

const slices = (keys: string[], src: Record<string, number>): Slice[] =>
  keys.map((k) => ({ name: k, value: Number(src[k] ?? 0), color: C[k] ?? '#f97316' }))

function Card({ title, icon: Icon, children, className = '' }: { title: string; icon: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <div className={`group bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-black/20 transition-all duration-300 hover:border-slate-700 hover:-translate-y-0.5 ${className}`}>
      <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Icon size={15} className="text-orange-400" aria-hidden="true" /> {title}
      </h3>
      {children}
    </div>
  )
}

function Tile({ label, value, prefix, suffix, color = 'text-slate-100' }: { label: string; value: number; prefix?: string; suffix?: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}><CountUp value={value} prefix={prefix} suffix={suffix} /></p>
    </div>
  )
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { from, to } = await searchParams
  const { fromISO, toISO, label } = resolveRange(from, to)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'sales_agent') redirect('/')

  const { data, error } = await supabase.rpc('report_executive_summary', { from_ts: fromISO ?? null, to_ts: toISO ?? null })
  const s: ExecSummary = error || !data ? EMPTY : { ...EMPTY, ...(data as ExecSummary) }

  const totalLeads = Object.values(s.leads_by_status).reduce((a, b) => a + Number(b), 0)
  const wonLeads = Number(s.leads_by_status['Closed Won'] ?? 0)
  const completedLeads = Number(s.leads_by_status['Completed'] ?? 0)
  const lostLeads = Number(s.leads_by_status['Lost'] ?? 0)
  const closedTotal = wonLeads + completedLeads + lostLeads
  const winRate = closedTotal > 0 ? Math.round(((wonLeads + completedLeads) / closedTotal) * 100) : 0

  const totalRevenue = Number(s.deals.total_revenue ?? 0)
  const paidRevenue = Number(s.deals.paid_revenue ?? 0)
  const outstanding = totalRevenue - paidRevenue

  const callsTotal = Number(s.calls.total ?? 0)
  const contractsSigned = Number(s.contracts_by_status['signed'] ?? 0)
  const contractsSent = Number(s.contracts_by_status['sent'] ?? 0)
  const supportOpen = Number(s.support_by_status['open'] ?? 0) + Number(s.support_by_status['in_progress'] ?? 0)
  const supportResolved = Number(s.support_by_status['resolved'] ?? 0)

  const pipelineSlices = slices([...PIPELINE_STAGES.filter((x) => x !== 'Disqualified'), 'Lost'], s.leads_by_status)
  const dealSlices = slices(['Paid', 'Partial', 'Pending', 'Overdue'], s.deals.by_status)
  const callSlices = slices(['interested_yes', 'interested_maybe', 'interested_no', 'do_not_call'], {
    interested_yes: s.calls.interested_yes, interested_maybe: s.calls.interested_maybe,
    interested_no: s.calls.interested_no, do_not_call: s.calls.do_not_call,
  })
  const emailSlices = slices(['delivered', 'sent', 'scheduled', 'bounced', 'failed', 'spam'], s.emails_by_status)

  const kpis = [
    { label: 'Total Leads', value: totalLeads, icon: Users, ring: 'from-blue-500/20 to-blue-500/0', color: 'text-blue-400' },
    { label: 'Closed Won', value: wonLeads, icon: TrendingUp, ring: 'from-green-500/20 to-green-500/0', color: 'text-green-400' },
    { label: 'Revenue Collected', value: paidRevenue, prefix: '$', icon: DollarSign, ring: 'from-orange-500/20 to-orange-500/0', color: 'text-orange-400' },
    { label: 'Outstanding', value: outstanding, prefix: '$', icon: Wallet, ring: 'from-yellow-500/20 to-yellow-500/0', color: 'text-yellow-400' },
    { label: 'Win Rate', value: winRate, suffix: '%', icon: Percent, ring: 'from-teal-500/20 to-teal-500/0', color: 'text-teal-400' },
  ]

  return (
    <>
      <Header title="Dashboard" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        <ReportsDateFilter from={from} to={to} label={label} />

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-sm text-red-300">
            Couldn’t load dashboard data: {error.message}. Run migration 056 if this persists.
          </div>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {kpis.map((kpi) => (
            <div key={kpi.label} className={`relative overflow-hidden bg-gradient-to-br ${kpi.ring} bg-slate-900 border border-slate-800 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-700`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{kpi.label}</span>
                <kpi.icon size={16} className={kpi.color} aria-hidden="true" />
              </div>
              <p className="text-2xl font-bold text-slate-100">
                <CountUp value={kpi.value} prefix={kpi.prefix} suffix={kpi.suffix} />
              </p>
            </div>
          ))}
        </div>

        {/* Donuts + bars */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Pipeline Distribution" icon={Users}>
            <Donut data={pipelineSlices} centerLabel="Leads" />
          </Card>

          <Card title="Deal Payment Status" icon={DollarSign}>
            <Donut data={dealSlices} centerLabel="Deals" />
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-800">
              <Tile label="Pipeline Value" value={totalRevenue} prefix="$" color="text-orange-400" />
              <Tile label="Collected" value={paidRevenue} prefix="$" color="text-green-400" />
              <Tile label="Outstanding" value={outstanding} prefix="$" color="text-yellow-400" />
            </div>
          </Card>

          <Card title="Call Outcomes" icon={PhoneCall}>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <Tile label="Total Calls" value={callsTotal} />
              <Tile label="Completed" value={s.calls.completed} color="text-green-400" />
              <Tile label="Appts Booked" value={s.calls.appointment_booked} color="text-teal-400" />
            </div>
            <HBars data={callSlices} />
          </Card>

          <Card title="Email Delivery" icon={Mail}>
            <HBars data={emailSlices} />
          </Card>
        </div>

        {/* Radial gauges strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <Card title="Demos Booked" icon={MonitorPlay}>
            <RadialGauge value={s.demos_booked} max={Math.max(s.demos_booked, totalLeads || 1)} color="#f59e0b" label="booked" />
          </Card>

          <Card title="Contracts" icon={FileSignature}>
            <RadialGauge value={contractsSigned} max={Math.max(contractsSent + contractsSigned, 1)} color="#22c55e" label={`${contractsSigned}/${contractsSent + contractsSigned} signed`} />
          </Card>

          <Card title="Support" icon={LifeBuoy}>
            <RadialGauge value={supportOpen} max={Math.max(supportOpen + supportResolved, 1)} color="#f97316" label={`${supportOpen} open`} />
          </Card>

          <Card title="Follow-ups" icon={Clock}>
            <RadialGauge value={s.followups.overdue} max={Math.max(s.followups.pending, 1)} color={s.followups.overdue > 0 ? '#dc2626' : '#22c55e'} label={`${s.followups.overdue} overdue`} />
          </Card>
        </div>
      </div>
    </>
  )
}
