'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, Calendar, Handshake, DollarSign, CheckCircle, Loader2, UserPlus } from 'lucide-react'

type Period = 'today' | '7d' | '30d' | 'month' | 'all'

interface UserKpi {
  id: string
  full_name: string
  role: string
  leads_added: number
  leads_assigned: number
  leads_completed: number
  demos_booked: number
  deals_closed: number
  revenue: number
}

const PERIOD_LABELS: Record<Period, string> = {
  'today': 'Today',
  '7d':    'Last 7 Days',
  '30d':   'Last 30 Days',
  'month': 'This Month',
  'all':   'All Time',
}

const ROLE_COLORS: Record<string, string> = {
  admin:       'from-orange-500 to-orange-700',
  agent:       'from-blue-500 to-blue-700',
  sales_agent: 'from-purple-500 to-purple-700',
}

interface Props {
  isAdmin: boolean
}

export function UserKpiSection({ isAdmin }: Props) {
  const [period, setPeriod] = useState<Period>('today')
  const [kpis, setKpis]     = useState<UserKpi[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [period])

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/reports/user-kpis?period=${period}`)
    const { kpis } = await res.json()
    setKpis(kpis || [])
    setLoading(false)
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            {isAdmin ? 'Team KPIs' : 'My KPIs'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Performance metrics per team member</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
          {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                period === p
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : kpis.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-8">No data for this period</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {kpis.map(u => (
            <div key={u.id} className="bg-slate-800/60 border border-slate-700/60 rounded-xl p-4">
              {/* User header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${ROLE_COLORS[u.role] || 'from-slate-500 to-slate-700'} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {u.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{u.full_name}</p>
                  <p className="text-xs text-slate-500 capitalize">{u.role.replace('_', ' ')}</p>
                </div>
              </div>

              {/* KPI metrics */}
              <div className="grid grid-cols-2 gap-2.5">
                <KpiMetric icon={UserPlus}     label="Leads Added"   value={u.leads_added}       color="text-sky-400"    bg="bg-sky-900/30" href={`/leads?agent=${u.id}&period=${period}`} />
                <KpiMetric icon={Users}        label="Assigned"      value={u.leads_assigned}     color="text-blue-400"   bg="bg-blue-900/30" />
                <KpiMetric icon={Calendar}     label="Demos Booked"  value={u.demos_booked}       color="text-purple-400" bg="bg-purple-900/30" />
                <KpiMetric icon={CheckCircle}  label="Completed"     value={u.leads_completed}    color="text-teal-400"   bg="bg-teal-900/30" />
                <KpiMetric icon={Handshake}    label="Deals Closed"  value={u.deals_closed}       color="text-green-400"  bg="bg-green-900/30" />
                <KpiMetric icon={DollarSign}   label="Revenue"       value={`$${u.revenue.toLocaleString()}`} color="text-orange-400" bg="bg-orange-900/30" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KpiMetric({ icon: Icon, label, value, color, bg, href }: {
  icon: any; label: string; value: number | string; color: string; bg: string; href?: string
}) {
  const inner = (
    <>
      <div className={`shrink-0 ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 truncate">{label}</p>
        <p className={`text-sm font-bold ${color}`}>{value}</p>
      </div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className={`${bg} rounded-lg p-2.5 flex items-center gap-2.5 hover:ring-1 hover:ring-sky-500/50 transition-all cursor-pointer`}>
        {inner}
      </Link>
    )
  }
  return (
    <div className={`${bg} rounded-lg p-2.5 flex items-center gap-2.5`}>
      {inner}
    </div>
  )
}
