'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe, AlertTriangle, CircleSlash, ArrowRight, Clock } from 'lucide-react'

// The SEO agent's queue. Ordering is the feature: worst-scoring and never-checked
// sites sit at the top, so "what do I work on today" is answered by scrolling to
// the first row rather than by reading 40 cards.

interface Row {
  id: string
  lead_id: string
  final_url: string | null
  last_seo_check_at: string | null
  seo_plan: 'none' | 'basic' | 'pro'
  seo_check_frequency: 'weekly' | 'monthly'
  assigned_seo_agent_id: string | null
  leads: { id: string; name: string | null; company_name: string | null } | null
  seo_agent: { id: string; full_name: string } | null
  latest: { onpage_score: number | null; psi_seo: number | null; psi_perf: number | null; ran_at: string; error: string | null } | null
  issues: { open: number; fail: number }
}

type Filter = 'all' | 'attention' | 'unassigned' | 'overdue'

const PLAN_PILL: Record<string, string> = {
  none:  'bg-slate-700/60 text-slate-400',
  basic: 'bg-blue-900/30 text-blue-400',
  pro:   'bg-orange-500/15 text-orange-400',
}

function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-500'
  if (score >= 70) return 'text-green-400'
  if (score >= 50) return 'text-orange-400'
  return 'text-red-400'
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function isOverdue(row: Row): boolean {
  const d = daysAgo(row.last_seo_check_at)
  if (d === null) return row.seo_plan !== 'none'
  return d > (row.seo_check_frequency === 'weekly' ? 7 : 30)
}

function lastCheckLabel(row: Row): string {
  const d = daysAgo(row.last_seo_check_at)
  if (d === null) return 'Never checked'
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d} days ago`
}

export function SeoBoardClient({
  rows,
  isAdmin,
  seoAgents,
}: {
  rows: Row[]
  isAdmin: boolean
  seoAgents: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [assigning, setAssigning] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const filtered = rows.filter(r => {
      if (filter === 'attention')  return r.issues.fail > 0 || (r.latest?.onpage_score ?? 100) < 70 || !!r.latest?.error
      if (filter === 'unassigned') return !r.assigned_seo_agent_id
      if (filter === 'overdue')    return isOverdue(r)
      return true
    })

    // Never-checked first (we know nothing and that's the biggest gap), then by
    // score ascending, then by open failures.
    return [...filtered].sort((a, b) => {
      const aScore = a.latest?.onpage_score ?? -1
      const bScore = b.latest?.onpage_score ?? -1
      if (aScore !== bScore) return aScore - bScore
      return b.issues.fail - a.issues.fail
    })
  }, [rows, filter])

  async function assign(siteId: string, agentId: string) {
    setAssigning(siteId)
    const res = await fetch('/api/seo/site', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, assigned_seo_agent_id: agentId || null }),
    })
    setAssigning(null)
    if (res.ok) router.refresh()
  }

  const counts = {
    all:        rows.length,
    attention:  rows.filter(r => r.issues.fail > 0 || (r.latest?.onpage_score ?? 100) < 70 || !!r.latest?.error).length,
    unassigned: rows.filter(r => !r.assigned_seo_agent_id).length,
    overdue:    rows.filter(isOverdue).length,
  }

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all',        label: 'All sites' },
    { key: 'attention',  label: 'Needs attention' },
    { key: 'overdue',    label: 'Check overdue' },
    ...(isAdmin ? [{ key: 'unassigned' as Filter, label: 'Unassigned' }] : []),
  ]

  return (
    <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white mb-1">Site Health</h1>
        <p className="text-slate-400 text-sm">
          Live client websites we monitor for SEO. Worst first.
        </p>
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === t.key
                ? 'bg-orange-500/15 text-orange-400 border border-orange-500/30'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700 hover:text-slate-200'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-slate-500">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-12 text-center">
          <Globe size={36} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">
            {rows.length === 0 ? 'No live sites assigned to you yet.' : 'Nothing matches this filter.'}
          </p>
          {rows.length === 0 && (
            <p className="text-slate-500 text-xs mt-1">
              Sites appear here once a Final URL is saved on the lead&apos;s Live tab.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60">
                <th scope="col" className="text-left px-5 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Site</th>
                <th scope="col" className="text-center px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">SEO</th>
                <th scope="col" className="text-center px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Speed</th>
                <th scope="col" className="text-left px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Issues</th>
                <th scope="col" className="text-left px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Last check</th>
                {isAdmin && <th scope="col" className="text-left px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Agent</th>}
                <th scope="col" className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sorted.map(row => {
                const lead = row.leads
                const overdue = isOverdue(row)
                return (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700
                                        flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(lead?.company_name ?? lead?.name ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{lead?.company_name ?? lead?.name ?? '—'}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 truncate">
                              {(row.final_url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${PLAN_PILL[row.seo_plan]}`}>
                              {row.seo_plan === 'none' ? 'no plan' : row.seo_plan}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-4 text-center">
                      <span className={`text-lg font-bold ${scoreClass(row.latest?.onpage_score)}`}>
                        {row.latest?.onpage_score ?? '—'}
                      </span>
                    </td>

                    <td className="px-3 py-4 text-center">
                      <span className={`text-sm font-semibold ${scoreClass(row.latest?.psi_perf)}`}>
                        {row.latest?.psi_perf ?? '—'}
                      </span>
                    </td>

                    <td className="px-3 py-4">
                      {row.latest?.error ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                          <CircleSlash size={12} /> Crawl failed
                        </span>
                      ) : row.issues.open === 0 ? (
                        <span className="text-xs text-slate-500">Clean</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs ${row.issues.fail ? 'text-red-400' : 'text-orange-400'}`}>
                          <AlertTriangle size={12} />
                          {row.issues.open} open
                          {row.issues.fail > 0 && <span className="text-slate-500">· {row.issues.fail} critical</span>}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs ${overdue ? 'text-orange-400' : 'text-slate-400'}`}>
                        {overdue && <Clock size={12} />}
                        {lastCheckLabel(row)}
                      </span>
                    </td>

                    {isAdmin && (
                      <td className="px-3 py-4">
                        <select
                          value={row.assigned_seo_agent_id ?? ''}
                          disabled={assigning === row.id}
                          onChange={e => assign(row.id, e.target.value)}
                          aria-label={`Assign SEO agent for ${lead?.company_name ?? 'site'}`}
                          className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5
                                     focus:outline-none focus:border-orange-500 max-w-[9rem]"
                        >
                          <option value="">Unassigned</option>
                          {seoAgents.map(a => (
                            <option key={a.id} value={a.id}>{a.full_name}</option>
                          ))}
                        </select>
                      </td>
                    )}

                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/seo/${row.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                   bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors whitespace-nowrap"
                      >
                        Open <ArrowRight size={11} />
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
