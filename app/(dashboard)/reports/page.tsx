import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, PIPELINE_STAGES } from '@/types'
import { STATUS_COLORS } from '@/lib/utils'
import { TrendingUp, Users, DollarSign, CheckCircle } from 'lucide-react'

export default async function ReportsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role === 'developer') redirect('/')

  const { data: leads } = await supabase.from('leads').select('status, created_at, assigned_agent_id')
  const { data: deals } = await supabase.from('deals').select('payment_status, final_payment_amount, token_amount')
  const { data: agents } = await supabase.from('profiles').select('id, full_name').in('role', ['agent', 'sales_agent', 'admin'])

  const totalLeads = leads?.length || 0
  const wonLeads = leads?.filter((l) => l.status === 'Closed Won').length || 0
  const completedLeads = leads?.filter((l) => l.status === 'Completed').length || 0
  const lostLeads = leads?.filter((l) => l.status === 'Lost').length || 0

  const totalRevenue = deals?.reduce((sum, d) => sum + (d.final_payment_amount || 0), 0) || 0
  const paidRevenue = deals?.filter((d) => d.payment_status === 'Paid').reduce((sum, d) => sum + (d.final_payment_amount || 0), 0) || 0

  const byStatus = PIPELINE_STAGES.reduce<Record<string, number>>((acc, stage) => {
    acc[stage] = leads?.filter((l) => l.status === stage).length || 0
    return acc
  }, {})

  const agentPerformance = agents?.map((agent) => ({
    ...agent,
    total: leads?.filter((l) => l.assigned_agent_id === agent.id).length || 0,
    won: leads?.filter((l) => l.assigned_agent_id === agent.id && l.status === 'Closed Won').length || 0,
  })).sort((a, b) => b.total - a.total)

  return (
    <>
      <Header title="Reports" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <kpi.icon size={15} className={kpi.color} />
                </div>
              </div>
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
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
                  <div key={stage} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-32 truncate">{stage}</span>
                    <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-400 w-8 text-right">{count}</span>
                  </div>
                )
              })}
              {lostLeads > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-32">Lost</span>
                  <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-red-600 rounded-full" style={{ width: `${(lostLeads / totalLeads) * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-slate-400 w-8 text-right">{lostLeads}</span>
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
                      {agent.full_name.charAt(0)}
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
