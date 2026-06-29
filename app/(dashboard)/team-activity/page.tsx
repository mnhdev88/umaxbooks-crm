import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { formatDate, timeAgo } from '@/lib/utils'
import { resolveRange } from '@/lib/report-range'
import { ReportsDateFilter } from '@/components/reports/ReportsDateFilter'
import { Activity } from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  admin:         'from-orange-500 to-orange-700',
  agent:         'from-blue-500 to-blue-700',
  sales_agent:   'from-purple-500 to-purple-700',
  sales_manager: 'from-amber-500 to-amber-700',
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>
}

type ActivityRow = {
  id: string
  action: string
  details: string | null
  created_at: string
  user_id: string | null
  leads: { id: string; company_name: string | null } | { id: string; company_name: string | null }[] | null
}

/**
 * Consolidated activity feed for a sales_manager's whole team (admins see all agents).
 * One reverse-chronological timeline merging every agent's logged actions — notes, calls,
 * demos booked, reassignments, emails, status changes — so a manager can see at a glance
 * what their team has been doing. Per-agent drill-down lives at /team/[agentId].
 *
 * Activity rows are also RLS-scoped (migration 070) so this can't leak outside the team.
 */
export default async function TeamActivityPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { from, to } = await searchParams
  const { fromISO, toISO, label } = resolveRange(from, to)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'
  const isManager = profile?.role === 'sales_manager'
  if (!profile || (!isAdmin && !isManager)) redirect('/')

  // Whose activity: a manager's own team; an admin sees every sales agent/manager.
  const agentsQuery = supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .order('full_name')
  const { data: agents } = isAdmin
    ? await agentsQuery.in('role', ['agent', 'sales_agent', 'sales_manager'])
    : await agentsQuery.eq('manager_id', user.id)

  const agentList = agents || []
  const agentIds = agentList.map((a) => a.id)
  const agentById = Object.fromEntries(agentList.map((a) => [a.id, a]))

  let events: ActivityRow[] = []
  if (agentIds.length) {
    let q = supabase
      .from('activity_logs')
      .select('id, action, details, created_at, user_id, leads(id, company_name)')
      .in('user_id', agentIds)
      .order('created_at', { ascending: false })
      .limit(100)
    if (fromISO) q = q.gte('created_at', fromISO)
    if (toISO) q = q.lt('created_at', toISO)
    const { data } = await q
    events = (data as ActivityRow[]) || []
  }

  // Group the timeline by calendar day for readable section headers.
  const groups = events.reduce<Record<string, ActivityRow[]>>((acc, ev) => {
    const key = ev.created_at.slice(0, 10) // YYYY-MM-DD
    ;(acc[key] ||= []).push(ev)
    return acc
  }, {})
  const days = Object.keys(groups).sort((a, b) => b.localeCompare(a))

  return (
    <>
      <Header title="Team Activity" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Activity size={16} className="text-orange-400" aria-hidden="true" />
            {isAdmin ? 'All agent activity' : 'My team’s activity'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Everything your {isAdmin ? 'agents' : 'team'} has logged — newest first. Open an agent from{' '}
            <Link href="/team" className="text-orange-400 hover:underline">My Team</Link> for their full profile.
          </p>
        </div>

        <ReportsDateFilter from={from} to={to} label={label} />

        {agentIds.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No agents on your team yet.</p>
        ) : events.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No activity in this period.</p>
        ) : (
          <div className="space-y-5">
            {days.map((day) => (
              <div key={day} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-1">
                  {formatDate(day)}
                </h3>
                <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
                  {groups[day].map((ev) => {
                    const agent = ev.user_id ? agentById[ev.user_id] : null
                    const leadRaw = ev.leads as any
                    const lead = (Array.isArray(leadRaw) ? leadRaw[0] : leadRaw) as
                      { id: string; company_name: string | null } | null | undefined
                    return (
                      <div key={ev.id} className="flex items-start gap-3 px-4 py-3">
                        <div
                          className={`w-8 h-8 rounded-full bg-gradient-to-br ${
                            ROLE_COLORS[agent?.role || ''] || 'from-slate-500 to-slate-700'
                          } flex items-center justify-center text-white text-xs font-bold shrink-0`}
                        >
                          {(agent?.full_name ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200">
                            <span className="font-semibold">{agent?.full_name || 'Someone'}</span>{' '}
                            <span className="text-slate-400">{ev.action.toLowerCase()}</span>
                            {lead && (
                              <>
                                {' · '}
                                <Link href={`/leads/${lead.id}`} className="text-orange-400 hover:underline">
                                  {lead.company_name || 'lead'}
                                </Link>
                              </>
                            )}
                          </p>
                          {ev.details && <p className="text-xs text-slate-500 truncate">{ev.details}</p>}
                        </div>
                        <span className="text-[11px] text-slate-600 shrink-0">{timeAgo(ev.created_at)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
