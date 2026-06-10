import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { timeAgo } from '@/lib/utils'
import { ChevronRight, UsersRound } from 'lucide-react'

const ROLE_COLORS: Record<string, string> = {
  admin:       'from-orange-500 to-orange-700',
  agent:       'from-blue-500 to-blue-700',
  sales_agent: 'from-purple-500 to-purple-700',
}

// Statuses that take a lead out of the active workload.
const TERMINAL = ['Completed', 'Lost', 'Disqualified']

export default async function TeamPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/')

  const { data: agents } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, created_at')
    .in('role', ['agent', 'sales_agent'])
    .order('full_name')

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

  return (
    <>
      <Header title="Team" profile={profile as Profile} />

      <div className="p-6 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <UsersRound size={16} className="text-orange-400" aria-hidden="true" />
            Agents
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Open a profile to see KPIs, current workload and recent activity.</p>
        </div>

        {rows.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-12">No agents yet.</p>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
            {rows.map((a) => (
              <Link
                key={a.id}
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
            ))}
          </div>
        )}
      </div>
    </>
  )
}
