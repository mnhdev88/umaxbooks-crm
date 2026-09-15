'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Plus, Trash2, FileText, Settings as SettingsIcon, ListChecks, History, Ban,
} from 'lucide-react'

// Everything the SEO agent does to one client site. Tabs rather than one long
// page because the three jobs are genuinely separate: clear the issue queue,
// log the month's work, and keep the monitoring settings right.

interface Site {
  id: string
  lead_id: string
  final_url: string | null
  last_seo_check_at: string | null
  seo_plan: 'none' | 'basic' | 'pro'
  seo_check_frequency: 'weekly' | 'monthly'
  seo_auto_report: boolean
  seo_report_email: string | null
  target_keywords: string[] | null
  gsc_property: string | null
  gbp_url: string | null
  domain_expiry: string | null
  ssl_expiry: string | null
  leads: { id: string; name: string | null; company_name: string | null; email: string | null } | null
}

interface Check {
  id: string
  ran_at: string
  source: 'manual' | 'auto'
  onpage_score: number | null
  psi_seo: number | null
  psi_perf: number | null
  psi_a11y: number | null
  cms: string | null
  onpage: any
  error: string | null
}

interface Issue {
  id: string
  check_key: string
  label: string
  severity: 'warn' | 'fail'
  detail: string | null
  impact: string | null
  status: 'open' | 'fixed' | 'ignored'
  first_seen_at: string
  fixed_at: string | null
  auto_fixed: boolean
  notes: string | null
}

interface Task {
  id: string
  title: string
  category: string
  status: 'todo' | 'doing' | 'done'
  due_date: string | null
  completed_at: string | null
  notes: string | null
}

interface Report {
  id: string
  period_start: string
  period_end: string
  status: 'draft' | 'sent'
  sent_at: string | null
  sent_to: string | null
}

type Tab = 'issues' | 'tasks' | 'history' | 'reports' | 'settings'

const CATEGORY_LABEL: Record<string, string> = {
  technical: 'Technical',
  content: 'Content',
  gbp: 'Google Business Profile',
  backlinks: 'Backlinks',
  other: 'Other',
}

function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'text-slate-500'
  if (score >= 70) return 'text-green-400'
  if (score >= 50) return 'text-orange-400'
  return 'text-red-400'
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' })
}

export function SeoSiteClient({
  site, checks, issues, tasks, reports, isAdmin,
}: {
  site: Site
  checks: Check[]
  issues: Issue[]
  tasks: Task[]
  reports: Report[]
  isAdmin: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('issues')
  const [running, setRunning] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const latest = checks[0] ?? null
  const previous = checks[1] ?? null
  const openIssues  = issues.filter(i => i.status === 'open')
  const closedIssues = issues.filter(i => i.status !== 'open')

  async function runCheck() {
    setRunning(true)
    setMsg(null)
    try {
      const res = await fetch('/api/seo/run-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id }),
      })
      const data = await res.json()
      if (res.ok) {
        setMsg({
          ok: true,
          text: `Score ${data.score}/100 · ${data.newIssues} new issue${data.newIssues === 1 ? '' : 's'}, ${data.fixedIssues} closed.`,
        })
        router.refresh()
      } else {
        setMsg({ ok: false, text: data.error || 'Check failed.' })
      }
    } catch {
      setMsg({ ok: false, text: 'Check failed.' })
    }
    setRunning(false)
  }

  const metrics = [
    { label: 'On-Page SEO',   now: latest?.onpage_score, before: previous?.onpage_score },
    { label: 'Google SEO',    now: latest?.psi_seo,      before: previous?.psi_seo },
    { label: 'Speed',         now: latest?.psi_perf,     before: previous?.psi_perf },
    { label: 'Accessibility', now: latest?.psi_a11y,     before: previous?.psi_a11y },
  ]

  const TABS: { key: Tab; label: string; icon: any; badge?: number }[] = [
    { key: 'issues',   label: 'Issues',   icon: AlertTriangle, badge: openIssues.length },
    { key: 'tasks',    label: 'Tasks',    icon: ListChecks,    badge: tasks.filter(t => t.status !== 'done').length },
    { key: 'history',  label: 'History',  icon: History },
    { key: 'reports',  label: 'Reports',  icon: FileText },
    { key: 'settings', label: 'Settings', icon: SettingsIcon },
  ]

  return (
    <div className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <Link href="/seo" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-orange-400 mb-4 transition-colors">
        <ArrowLeft size={13} /> Site Health
      </Link>

      {/* Site header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white mb-1 truncate">
            {site.leads?.company_name ?? site.leads?.name ?? 'Client site'}
          </h1>
          {site.final_url && (
            <a
              href={site.final_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-blue-400 transition-colors"
            >
              {site.final_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <button
          onClick={runCheck}
          disabled={running || !site.final_url}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                     bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed
                     text-white transition-colors"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Checking…' : 'Run check now'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-2.5 rounded-lg text-sm border ${
          msg.ok ? 'bg-green-900/20 border-green-800/40 text-green-400'
                 : 'bg-red-900/20 border-red-800/40 text-red-400'}`}>
          {msg.text}
        </div>
      )}

      {/* Scores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {metrics.map(m => {
          const delta = m.now != null && m.before != null ? m.now - m.before : null
          return (
            <div key={m.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
              <div className={`text-3xl font-bold ${scoreClass(m.now)}`}>{m.now ?? '—'}</div>
              <div className="text-xs text-slate-400 mt-1">{m.label}</div>
              {delta !== null && delta !== 0 && (
                <div className={`text-[11px] mt-0.5 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {delta > 0 ? '+' : ''}{delta} since last
                </div>
              )}
            </div>
          )
        })}
      </div>

      {latest?.error && (
        <div className="mb-5 px-4 py-3 rounded-lg bg-red-900/20 border border-red-800/40 text-red-400 text-sm">
          Last crawl failed: {latest.error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800 mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.key
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <t.icon size={14} />
            {t.label}
            {!!t.badge && (
              <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-300">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'issues'   && <IssuesTab open={openIssues} closed={closedIssues} onChange={() => router.refresh()} />}
      {tab === 'tasks'    && <TasksTab siteId={site.id} tasks={tasks} onChange={() => router.refresh()} />}
      {tab === 'history'  && <HistoryTab checks={checks} />}
      {tab === 'reports'  && <ReportsTab siteId={site.id} reports={reports} onChange={() => router.refresh()} />}
      {tab === 'settings' && <SettingsTab site={site} isAdmin={isAdmin} onChange={() => router.refresh()} />}
    </div>
  )
}

// ── Issues ───────────────────────────────────────────────────────────────────

function IssuesTab({ open, closed, onChange }: { open: Issue[]; closed: Issue[]; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function update(id: string, status: string) {
    setBusy(id)
    setError(null)
    const res = await fetch('/api/seo/issues', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setBusy(null)
    if (res.ok) {
      onChange()
    } else {
      // Reopening can collide with the one-open-issue-per-check rule when the
      // monitor has already reopened it — say so rather than doing nothing.
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Could not update that issue.')
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="px-4 py-2.5 rounded-lg text-sm bg-red-900/20 border border-red-800/40 text-red-400">
          {error}
        </div>
      )}
      {open.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <CheckCircle2 size={32} className="text-green-500/60 mx-auto mb-3" />
          <p className="text-slate-300">No open issues.</p>
          <p className="text-slate-500 text-xs mt-1">The monitor opens one automatically when a check starts failing.</p>
        </div>
      ) : (
        open.map(issue => (
          <div key={issue.id} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {issue.severity === 'fail'
                    ? <XCircle size={14} className="text-red-400 shrink-0" />
                    : <AlertTriangle size={14} className="text-orange-400 shrink-0" />}
                  <span className="text-white font-medium">{issue.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                    open {Math.max(0, Math.floor((Date.now() - new Date(issue.first_seen_at).getTime()) / 86_400_000))}d
                  </span>
                </div>
                {issue.detail && <p className="text-sm text-slate-300 mb-1">{issue.detail}</p>}
                {issue.impact && <p className="text-xs text-slate-500">{issue.impact}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => update(issue.id, 'fixed')}
                  disabled={busy === issue.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                             bg-green-900/30 hover:bg-green-900/50 text-green-400 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 size={12} /> Mark fixed
                </button>
                <button
                  onClick={() => update(issue.id, 'ignored')}
                  disabled={busy === issue.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                             bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-50"
                >
                  <Ban size={12} /> Ignore
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {closed.length > 0 && (
        <>
          <button
            onClick={() => setShowClosed(v => !v)}
            className="text-xs text-slate-400 hover:text-orange-400 transition-colors"
          >
            {showClosed ? 'Hide' : 'Show'} {closed.length} closed issue{closed.length === 1 ? '' : 's'}
          </button>
          {showClosed && (
            <div className="bg-slate-800/30 border border-slate-800 rounded-xl divide-y divide-slate-800">
              {closed.map(issue => (
                <div key={issue.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm text-slate-300">{issue.label}</span>
                    <span className="text-xs text-slate-500 ml-2">
                      {issue.status === 'ignored'
                        ? 'ignored'
                        : `fixed ${fmtDate(issue.fixed_at)}${issue.auto_fixed ? ' (detected)' : ''}`}
                    </span>
                  </div>
                  <button
                    onClick={() => update(issue.id, 'open')}
                    className="text-xs text-slate-400 hover:text-orange-400 transition-colors shrink-0"
                  >
                    Reopen
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Tasks ────────────────────────────────────────────────────────────────────

function TasksTab({ siteId, tasks, onChange }: { siteId: string; tasks: Task[]; onChange: () => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('technical')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    const res = await fetch('/api/seo/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, title, category, dueDate: dueDate || null }),
    })
    setSaving(false)
    if (res.ok) {
      setTitle(''); setDueDate('')
      onChange()
    }
  }

  async function toggle(task: Task) {
    const next = task.status === 'done' ? 'todo' : 'done'
    const res = await fetch('/api/seo/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: next }),
    })
    if (res.ok) onChange()
  }

  async function remove(id: string) {
    const res = await fetch(`/api/seo/tasks?id=${id}`, { method: 'DELETE' })
    if (res.ok) onChange()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What are you doing for this client?"
          aria-label="Task title"
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2
                     placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          aria-label="Task category"
          className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2
                     focus:outline-none focus:border-orange-500"
        >
          {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          aria-label="Due date"
          className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2
                     focus:outline-none focus:border-orange-500"
        />
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                     bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white transition-colors"
        >
          <Plus size={14} /> Add
        </button>
      </form>

      <p className="text-xs text-slate-500">
        Completed tasks become the &ldquo;work delivered&rdquo; section of the client&apos;s monthly report.
      </p>

      {tasks.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <p className="text-slate-400">No tasks yet.</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-800">
          {tasks.map(task => (
            <div key={task.id} className="px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => toggle(task)}
                aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`}
                className={`w-5 h-5 rounded border shrink-0 flex items-center justify-center transition-colors ${
                  task.status === 'done'
                    ? 'bg-green-600 border-green-600'
                    : 'border-slate-600 hover:border-orange-500'
                }`}
              >
                {task.status === 'done' && <CheckCircle2 size={12} className="text-white" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${task.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                  {task.title}
                </p>
                <p className="text-xs text-slate-500">
                  {CATEGORY_LABEL[task.category] ?? task.category}
                  {task.due_date && ` · due ${fmtDate(task.due_date)}`}
                  {task.completed_at && ` · done ${fmtDate(task.completed_at)}`}
                </p>
              </div>
              <button
                onClick={() => remove(task.id)}
                aria-label={`Delete ${task.title}`}
                className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── History ──────────────────────────────────────────────────────────────────

function HistoryTab({ checks }: { checks: Check[] }) {
  if (checks.length === 0) {
    return (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
        <p className="text-slate-400">No checks run yet.</p>
        <p className="text-slate-500 text-xs mt-1">Run one now, or wait for the nightly monitor.</p>
      </div>
    )
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 bg-slate-800/60">
            <th scope="col" className="text-left px-4 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">When</th>
            <th scope="col" className="text-center px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">On-page</th>
            <th scope="col" className="text-center px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">SEO</th>
            <th scope="col" className="text-center px-3 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Speed</th>
            <th scope="col" className="text-left px-4 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {checks.map(c => (
            <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
              <td className="px-4 py-3 text-slate-300">
                {new Date(c.ran_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                {c.error && <span className="ml-2 text-xs text-red-400">failed</span>}
              </td>
              <td className={`px-3 py-3 text-center font-semibold ${scoreClass(c.onpage_score)}`}>{c.onpage_score ?? '—'}</td>
              <td className={`px-3 py-3 text-center ${scoreClass(c.psi_seo)}`}>{c.psi_seo ?? '—'}</td>
              <td className={`px-3 py-3 text-center ${scoreClass(c.psi_perf)}`}>{c.psi_perf ?? '—'}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">
                {c.source === 'auto' ? 'Monitor' : 'Manual'}{c.cms ? ` · ${c.cms}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Reports ──────────────────────────────────────────────────────────────────

function ReportsTab({ siteId, reports, onChange }: { siteId: string; reports: Report[]; onChange: () => void }) {
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function generate() {
    setGenerating(true)
    setMsg(null)
    const res = await fetch('/api/seo/report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    })
    const data = await res.json()
    setGenerating(false)
    setMsg(res.ok ? 'Draft ready — review and send it from Client Reports.' : (data.error || 'Could not generate.'))
    if (res.ok) onChange()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500 max-w-md">
          Reports are drafted automatically at the start of each month. Generate one early
          if the client asks.
        </p>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium
                     bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-100 transition-colors"
        >
          <FileText size={14} /> {generating ? 'Building…' : 'Generate last month'}
        </button>
      </div>

      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      {reports.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-10 text-center">
          <p className="text-slate-400">No reports yet.</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-800">
          {reports.map(r => (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-200">
                  {new Date(`${r.period_start}T00:00:00Z`).toLocaleDateString('en-US', {
                    month: 'long', year: 'numeric', timeZone: 'UTC',
                  })}
                </p>
                <p className="text-xs text-slate-500">
                  {r.status === 'sent' ? `Sent ${fmtDate(r.sent_at)} to ${r.sent_to}` : 'Draft — not sent'}
                </p>
              </div>
              {r.status === 'draft' && (
                <Link
                  href="/seo/reports"
                  className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 transition-colors shrink-0"
                >
                  Review &amp; send
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

function SettingsTab({ site, isAdmin, onChange }: { site: Site; isAdmin: boolean; onChange: () => void }) {
  const [plan, setPlan]             = useState(site.seo_plan)
  const [freq, setFreq]             = useState(site.seo_check_frequency)
  const [autoReport, setAutoReport] = useState(site.seo_auto_report)
  const [reportEmail, setReportEmail] = useState(site.seo_report_email ?? '')
  const [keywords, setKeywords]     = useState((site.target_keywords ?? []).join(', '))
  const [gbp, setGbp]               = useState(site.gbp_url ?? '')
  const [gsc, setGsc]               = useState(site.gsc_property ?? '')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setSaved(null)
    const res = await fetch('/api/seo/site', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId: site.id,
        seo_plan: plan,
        seo_check_frequency: freq,
        seo_auto_report: autoReport,
        seo_report_email: reportEmail.trim() || null,
        target_keywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        gbp_url: gbp.trim() || null,
        gsc_property: gsc.trim() || null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    setSaved(res.ok ? 'Saved.' : (data.error || 'Could not save.'))
    if (res.ok) onChange()
  }

  const field = 'w-full bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-orange-500'
  const label = 'block text-xs text-slate-400 mb-1.5'

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 space-y-5 max-w-2xl">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="seo-plan" className={label}>SEO plan</label>
          <select id="seo-plan" value={plan} onChange={e => setPlan(e.target.value as any)} className={field}>
            <option value="none">No plan — not monitored</option>
            <option value="basic">Basic</option>
            <option value="pro">Pro</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">Sites with no plan are skipped by the monitor.</p>
        </div>

        <div>
          <label htmlFor="seo-freq" className={label}>Check frequency</label>
          <select id="seo-freq" value={freq} onChange={e => setFreq(e.target.value as any)} className={field}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="report-email" className={label}>Report recipient</label>
        <input
          id="report-email"
          type="email"
          value={reportEmail}
          onChange={e => setReportEmail(e.target.value)}
          placeholder={site.leads?.email ?? 'client@example.com'}
          className={field}
        />
        <p className="text-[11px] text-slate-500 mt-1">
          Leave blank to use the lead&apos;s email ({site.leads?.email ?? 'none on file'}).
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoReport}
          onChange={e => setAutoReport(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-900 text-orange-500 focus:ring-orange-500"
        />
        <span>
          <span className="text-sm text-slate-200">Send the monthly report automatically</span>
          <span className="block text-[11px] text-slate-500 mt-0.5">
            A draft you haven&apos;t reviewed within 3 days goes out on its own. Leave this off to
            always send by hand — worth doing for clients whose scores move a lot.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="keywords" className={label}>Target keywords</label>
        <input
          id="keywords"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="plumber dubai, emergency plumbing"
          className={field}
        />
        <p className="text-[11px] text-slate-500 mt-1">Comma separated. Recorded now, used when rank tracking is added.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="gbp" className={label}>Google Business Profile</label>
          <input id="gbp" value={gbp} onChange={e => setGbp(e.target.value)} placeholder="https://…" className={field} />
        </div>
        <div>
          <label htmlFor="gsc" className={label}>Search Console property</label>
          <input id="gsc" value={gsc} onChange={e => setGsc(e.target.value)} placeholder="sc-domain:example.com" className={field} />
        </div>
      </div>

      {isAdmin && (
        <p className="text-[11px] text-slate-500 border-t border-slate-700 pt-4">
          Assign this site to an SEO agent from the Site Health board.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-600
                     disabled:opacity-50 text-white transition-colors"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-slate-400">{saved}</span>}
      </div>
    </div>
  )
}
