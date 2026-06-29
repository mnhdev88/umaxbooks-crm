import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { timeAgo } from '@/lib/utils'
import { ChevronRight, UsersRound, Download } from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  admin:         'from-orange-500 to-orange-700',
  agent:         'from-blue-500 to-blue-700',
  sales_agent:   'from-purple-500 to-purple-700',
  sales_manager: 'from-amber-500 to-amber-700',
}

// Statuses that take a lead out of the active workload.
const TERMINAL = ['Completed', 'Lost', 'Disqualified']

interface AgentRow {
  id: string
  full_name: string | null
  email: string
  role: string
  manager_id?: string | null
  assigned: number
  open: number
  lastActive?: string
}

function AgentRowLink({ a }: { a: AgentRow }) {
  return (
    <Link
      href={`/team/${a.id}`}
      className="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-800/50 transition-colors first:rounded-t-xl last:rounded-b-xl"
    >
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${ROLE_COLORS[a.role] || 'from-slate-500 to-slate-700'} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
        {(a.full_name ?? '?').charAt(0).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-100 truncate">{a.full_name || a.email}</p>
        <p className="text-xs text-slate-500 truncate capitalize">{a.role.replace('_', ' ')} · {a.email}</p>
      </div>

      <div className="hidden sm:flex items-center gap-6 text-right">
        <div>
          <p className="text-sm font-bold text-blue-400 tabular-nums">{a.open}</p>
          <p className="text-[11px] text-slate-500">open</p>
        </div>
        <div>
          <p className="text-sm font-bold text-slate-200 tabular-nums">{a.assigned}</p>
          <p className="text-[11px] text-slate-500">assigned</p>
        </div>
        <div className="w-20">
          <p className="text-xs font-medium text-slate-300">{a.lastActive ? timeAgo(a.lastActive) : '—'}</p>
          <p className="text-[11px] text-slate-500">last active</p>
        </div>
      </div>

      <ChevronRight size={16} className="text-slate-600 shrink-0" aria-hidden="true" />
    </Link>
  )
}

export default async function TeamPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const isAdmin = profile?.role === 'admin'
  const isManager = profile?.role === 'sales_manager'
  if (!profile || (!isAdmin && !isManager)) redirect('/')

  // Admins see every agent (grouped by manager); a manager sees only their own team.
  const agentsQuery = supabase
    .from('profiles')
    .select('id, full_name, email, role, manager_id, created_at')
    .order('full_name')

  const { data: agents } = isAdmin
    ? await agentsQuery.in('role', ['agent', 'sales_agent', 'sales_manager'])
    : await agentsQuery.eq('manager_id', user.id)

  const list = agents || []
  const notTerminal = `(${TERMINAL.map(s => `"${s}"`).join(',')})`

  // Per-agent snapshot: total assigned, currently-open (non-terminal), last activity.
  // Counts use head queries so the PostgREST 1000-row cap never bites.
  const rows = await Promise.all(list.map(async (a) => {
    const [assignedRes, openRes, lastActRes] = await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_agent_id', a.id),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('assigned_agent_id', a.id).not('status', 'in', notTerminal),
      supabase.from('activity_logs').select('created_at').eq('user_id', a.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    return {
      ...a,
      assigned: assignedRes.count || 0,
      open: openRes.count || 0,
      lastActive: lastActRes.data?.created_at as string | undefined,
    }
  }))

  // Admin view groups agents under their manager; an unmanaged bucket catches
  // the rest. A manager's own view is a single flat "My Team" list.
  const managerRows = rows.filter(r => r.role === 'sales_manager')
  const groups: { key: string; header: AgentRow | null; title?: string; items: AgentRow[] }[] = isAdmin
    ? [
        ...managerRows.map(m => ({
          key: m.id,
          header: m,
          items: rows.filter(r => r.manager_id === m.id),
        })),
        {
          key: 'unmanaged',
          header: null,
          title: 'No manager',
          items: rows.filter(r => r.role !== 'sales_manager' && !r.manager_id),
        },
      ].filter(g => g.header || g.items.length > 0)
    : [{ key: 'team', header: null, title: 'My Team', items: rows }]

  return (
    <>
      <Header title="Team" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <UsersRound size={16} className="text-orange-400" aria-hidden="true" />
              Agents
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Open a profile to see KPIs, current workload and recent activity.</p>
          </div>
          {isAdmin && list.length > 0 && (
            <a
              href="/api/reports/agent-performance"
              download
              className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600 transition-colors shrink-0"
            >
              <Download size={14} aria-hidden="true" />
              Performance report (CSV)
            </a>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">
            {isManager ? 'No agents on your team yet.' : 'No agents yet.'}
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => (
              <div key={g.key} className="space-y-2">
                {g.header ? (
                  // Manager group — the manager is a clickable header with their own stats.
                  <Link
                    href={`/team/${g.header.id}`}
                    className="flex items-center gap-3 px-1 group/header"
                  >
                    <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${ROLE_COLORS[g.header.role]} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                      {(g.header.full_name ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-semibold text-slate-100 group-hover/header:text-orange-400 transition-colors">
                      {g.header.full_name || g.header.email}
                    </span>
                    <span className="text-[11px] font-medium text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full">Manager</span>
                    <span className="text-xs text-slate-500">{g.items.length} {g.items.length === 1 ? 'agent' : 'agents'}</span>
                  </Link>
                ) : (
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-1">{g.title}</h3>
                )}

                {g.items.length === 0 ? (
                  <p className="text-xs text-slate-600 px-1 pb-1">No agents assigned.</p>
                ) : (
                  <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
                    {g.items.map((a) => <AgentRowLink key={a.id} a={a} />)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
