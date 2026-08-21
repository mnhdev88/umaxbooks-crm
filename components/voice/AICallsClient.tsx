'use client'

import { useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { VoiceCall } from '@/types'
import { Search, Calendar, X, Globe2 } from 'lucide-react'
import { CallCard, type VoiceCallWithLead } from './CallCard'
import { DEFAULT_REPORT_TZ } from '@/lib/reporting-day'

// Re-export so the page (and any existing importers) keep their import path.
export type { VoiceCallWithLead } from './CallCard'

type OutcomeKey =
  | 'all' | 'interested' | 'not_interested' | 'appointments' | 'callbacks' | 'voicemail' | 'dnc'

const OUTCOMES: { key: OutcomeKey; label: string }[] = [
  { key: 'all',            label: 'All' },
  { key: 'interested',     label: 'Interested' },
  { key: 'not_interested', label: 'Not interested' },
  { key: 'appointments',   label: 'Appointments' },
  { key: 'callbacks',      label: 'Callbacks' },
  { key: 'voicemail',      label: 'Voicemail' },
  { key: 'dnc',            label: 'Do not call' },
]

type ProviderKey = 'all' | 'twilio' | 'bland' | 'inbound'
const PROVIDERS: { key: ProviderKey; label: string }[] = [
  { key: 'all',     label: 'All calls' },
  { key: 'twilio',  label: 'Dialer' },
  { key: 'inbound', label: 'Incoming' },
  { key: 'bland',   label: 'AI' },
]

// 'smart' surfaces the calls that still need someone to do something; the other
// modes flatten the whole list to one rule. Mirrors the pipeline board's sort menu.
type SortMode = 'smart' | 'date_new' | 'date_old' | 'name_asc' | 'name_desc' | 'duration_desc'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'smart',         label: 'Smart Sort (default)' },
  { value: 'date_new',      label: 'Date (Newest)' },
  { value: 'date_old',      label: 'Date (Oldest)' },
  { value: 'name_asc',      label: 'Company Name (A–Z)' },
  { value: 'name_desc',     label: 'Company Name (Z–A)' },
  { value: 'duration_desc', label: 'Longest Call' },
]

function matchesOutcome(call: VoiceCall, f: OutcomeKey): boolean {
  switch (f) {
    case 'interested':     return call.interested === 'yes' || call.interested === 'maybe'
    // A hard opt-out is its own tab — "not interested" is the soft no, so a lead
    // who only said "not right now" doesn't get buried under the DNC list.
    case 'not_interested': return call.interested === 'no'
    case 'appointments':   return !!call.appointment_booked
    case 'callbacks':      return !!call.callback_requested
    case 'voicemail':      return call.answered_by === 'voicemail'
    case 'dnc':            return !!call.do_not_call
    default:               return true
  }
}

function matchesProvider(call: VoiceCall, p: ProviderKey): boolean {
  if (p === 'all') return true
  const isInbound = call.direction === 'inbound'
  if (p === 'inbound') return isInbound
  // Inbound rows are provider='twilio' as well, so Dialer has to exclude them —
  // otherwise a callback would show under both tabs.
  if (p === 'twilio') return call.provider === 'twilio' && !isInbound
  return call.provider !== 'twilio' // 'bland' (or legacy null)
}

// ── Smart Sort ────────────────────────────────────────────────────────────────
// Band 0-2 are "somebody owes this lead something", newest/soonest first inside
// each. Do-not-call sinks below the untouched calls: it's the one outcome where
// the correct next action is to do nothing.
function actionRank(c: VoiceCall): number {
  if (c.do_not_call) return 4
  if (c.callback_requested) return 0
  if (c.appointment_booked) return 1
  if (c.interested === 'yes' || c.interested === 'maybe') return 2
  return 3
}

function newestFirst(a: VoiceCall, b: VoiceCall): number {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

// Soonest scheduled time first, so overdue commitments lead. A call flagged for a
// callback with no time on it floats above the scheduled ones — it still needs
// booking, same rule the pipeline's Callback Booked column uses.
function bySchedule(ta: string | null, tb: string | null, a: VoiceCall, b: VoiceCall): number {
  if (!ta && !tb) return newestFirst(a, b)
  if (!ta) return -1
  if (!tb) return 1
  return new Date(ta).getTime() - new Date(tb).getTime()
}

function smartCompare(a: VoiceCall, b: VoiceCall): number {
  const ra = actionRank(a)
  const rb = actionRank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return bySchedule(a.callback_time, b.callback_time, a, b)
  if (ra === 1) return bySchedule(a.appointment_time, b.appointment_time, a, b)
  return newestFirst(a, b)
}

function callSeconds(c: VoiceCall): number {
  return c.duration_sec ?? Math.round((c.call_length_min ?? 0) * 60)
}

function companyOf(c: VoiceCallWithLead): string {
  return c.lead?.company_name || c.lead?.name || ''
}

// ── Dates ─────────────────────────────────────────────────────────────────────
// Calendar days in the business timezone, not the browser's: an agent travelling
// (or a VPS on UTC) must not see a call slide into the previous day.
function makeYmd(tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return (iso: string) => fmt.format(new Date(iso))
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function StatChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 min-w-[120px]">
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

/** Whole-table counts, computed server-side — see the comment in the page component. */
export interface CallStats {
  total: number
  dialer: number
  inbound: number
  ai: number
  interested: number
  dnc: number
}

/** The date window the server actually queried, echoed back so the UI can say so. */
export interface DateRangeInfo {
  from?: string
  to?: string
  label: string
  tz: string
  /** true when from/to were in the URL, i.e. the rows below came from a scoped query. */
  applied: boolean
}

export function AICallsClient({
  initialCalls,
  stats,
  dateRange,
}: {
  initialCalls: VoiceCallWithLead[]
  stats: CallStats
  dateRange: DateRangeInfo
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [outcome, setOutcome] = useState<OutcomeKey>('all')
  const [provider, setProvider] = useState<ProviderKey>('all')
  const [agentId, setAgentId] = useState<string>('all')
  const [sortMode, setSortMode] = useState<SortMode>('smart')
  const [query, setQuery] = useState('')
  // Dates start out as a local filter over the loaded rows; they only reach the
  // database when the range needs calls older than that window (see below).
  const [from, setFrom] = useState<string>(dateRange.from ?? '')
  const [to, setTo] = useState<string>(dateRange.to ?? '')

  const tz = dateRange.tz || DEFAULT_REPORT_TZ
  const ymd = useMemo(() => makeYmd(tz), [tz])

  // The tiles describe every call in the queried window; the list below holds only
  // the most recent page of them, and the client filters run over that page. Say so
  // when the two differ, rather than letting "AI 249" sit above an empty list.
  const truncated = stats.total > initialCalls.length

  // Oldest call the browser actually has. Rows arrive newest-first, but don't rely
  // on that — a date filter that silently under-reports is the bug we're avoiding.
  const oldestLoadedYmd = useMemo(() => {
    let oldest: string | null = null
    for (const c of initialCalls) {
      const d = ymd(c.created_at)
      if (!oldest || d < oldest) oldest = d
    }
    return oldest
  }, [initialCalls, ymd])

  const today = useMemo(() => ymd(new Date().toISOString()), [ymd])
  const PRESETS = useMemo(() => [
    { key: 'today',     label: 'Today',   range: { from: today, to: today } },
    { key: 'yesterday', label: 'Yesterday', range: { from: shiftDate(today, -1), to: shiftDate(today, -1) } },
    { key: 'last7',     label: 'Last 7 days',  range: { from: shiftDate(today, -6), to: today } },
    { key: 'last30',    label: 'Last 30 days', range: { from: shiftDate(today, -29), to: today } },
  ], [today])

  const activePreset = PRESETS.find(p => p.range.from === from && p.range.to === to)?.key
  const hasDateFilter = !!from || !!to

  // Distinct agents that placed dialer calls, for the agent filter.
  const agents = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of initialCalls) {
      if (c.agent_user_id && c.agent?.full_name) map.set(c.agent_user_id, c.agent.full_name)
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }))
  }, [initialCalls])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const result = initialCalls.filter(c => {
      if (!matchesProvider(c, provider)) return false
      if (!matchesOutcome(c, outcome)) return false
      if (agentId !== 'all' && c.agent_user_id !== agentId) return false
      if (from || to) {
        const d = ymd(c.created_at)
        if (from && d < from) return false
        if (to && d > to) return false
      }
      if (!q) return true
      const hay = [
        c.lead?.company_name, c.lead?.name, c.lead?.phone,
        c.summary, c.notes, c.objection, c.agent?.full_name,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })

    switch (sortMode) {
      case 'date_new':      return result.sort(newestFirst)
      case 'date_old':      return result.sort((a, b) => -newestFirst(a, b))
      case 'name_asc':      return result.sort((a, b) => companyOf(a).localeCompare(companyOf(b)))
      case 'name_desc':     return result.sort((a, b) => companyOf(b).localeCompare(companyOf(a)))
      case 'duration_desc': return result.sort((a, b) => callSeconds(b) - callSeconds(a))
      default:              return result.sort(smartCompare)
    }
  }, [initialCalls, provider, outcome, agentId, query, sortMode, from, to, ymd])

  // The loaded page can only answer a date range that sits inside it. If the range
  // reaches back before the oldest loaded call — and there are older calls to reach —
  // the local filter is incomplete and we offer the database query instead.
  const rangeMatchesUrl = (dateRange.from ?? '') === from && (dateRange.to ?? '') === to
  const needsServerSearch =
    hasDateFilter && truncated && !rangeMatchesUrl &&
    (!from || !oldestLoadedYmd || from < oldestLoadedYmd)

  function applyToUrl(next: { from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.from) params.set('from', next.from); else params.delete('from')
    if (next.to) params.set('to', next.to); else params.delete('to')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function clearDates() {
    setFrom('')
    setTo('')
    // A server-scoped view has to be unwound at the URL too, or the rows stay scoped.
    if (dateRange.applied) applyToUrl({})
  }

  const hasFilter =
    provider !== 'all' || outcome !== 'all' || agentId !== 'all' ||
    !!query.trim() || sortMode !== 'smart' || hasDateFilter

  return (
    <div className="p-6 space-y-5">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-3">
        <StatChip label="Total calls" value={stats.total}      cls="text-slate-100" />
        <StatChip label="Dialer"      value={stats.dialer}     cls="text-emerald-400" />
        <StatChip label="Incoming"    value={stats.inbound}    cls="text-sky-400" />
        <StatChip label="AI"          value={stats.ai}         cls="text-indigo-400" />
        <StatChip label="Interested"  value={stats.interested} cls="text-emerald-400" />
        <StatChip label="Do not call" value={stats.dnc}        cls="text-red-400" />
      </div>

      {dateRange.applied && (
        <p className="text-xs text-slate-400 -mt-2">
          Searched all calls in <span className="text-slate-200 font-medium">{dateRange.label}</span>.
          Totals above cover that range only.
        </p>
      )}

      {truncated && (
        <p className="text-xs text-slate-500 -mt-2">
          Totals above cover all {stats.total.toLocaleString()} calls{dateRange.applied ? ' in this range' : ''}.
          The list below shows the {initialCalls.length.toLocaleString()} most recent, and the filters apply to those.
        </p>
      )}

      {/* Provider toggle */}
      <div className="flex flex-wrap gap-1.5">
        {PROVIDERS.map(p => (
          <button
            key={p.key}
            onClick={() => setProvider(p.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              provider === p.key
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Outcome filters + agent + sort + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.map(f => (
            <button
              key={f.key}
              onClick={() => setOutcome(f.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                outcome === f.key
                  ? 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {agents.length > 0 && (
          <select
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            aria-label="Filter by agent"
            className="text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}

        {/* Sort — 'smart' floats the calls that still need action; the rest flatten
            the list to one rule. Same menu shape as the pipeline board. */}
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as SortMode)}
          aria-label="Sort calls"
          className="text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-orange-500 min-w-[160px]"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search lead, agent, summary…"
            className="w-64 max-w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {/* Date range — filters the loaded calls instantly; offers the database when
          the range reaches further back than what's loaded. */}
      <div className="flex flex-wrap items-center gap-2">
        <Calendar size={13} className="text-orange-400" aria-hidden="true" />
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setFrom(p.range.from); setTo(p.range.to) }}
              aria-pressed={activePreset === p.key}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                activePreset === p.key
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <input
          type="date"
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={e => setFrom(e.target.value)}
          className="text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 [color-scheme:dark] focus:outline-none focus:border-orange-500"
        />
        <span className="text-slate-500 text-xs">to</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          min={from || undefined}
          onChange={e => setTo(e.target.value)}
          className="text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 [color-scheme:dark] focus:outline-none focus:border-orange-500"
        />

        {hasDateFilter && (
          <button
            type="button"
            onClick={clearDates}
            aria-label="Clear date range"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={13} />
          </button>
        )}

        {needsServerSearch && (
          <button
            type="button"
            onClick={() => applyToUrl({ from: from || undefined, to: to || undefined })}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border bg-sky-500/15 text-sky-300 border-sky-500/40 hover:bg-sky-500/25 transition-colors"
          >
            <Globe2 size={12} aria-hidden="true" />
            Search all dates
          </button>
        )}

        {hasFilter && (
          <span className="text-xs text-slate-500 ml-auto">
            {visible.length} call{visible.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {needsServerSearch && (
        <p className="text-xs text-amber-400/90 -mt-2">
          This range goes further back than the {initialCalls.length.toLocaleString()} calls loaded here —
          older calls in it aren&apos;t shown. Use “Search all dates” to query the full history.
        </p>
      )}

      {/* List */}
      {visible.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          {initialCalls.length === 0
            ? 'No calls yet. Place a call from any lead with the “Call” or “AI Call” button — results show up here.'
            : 'No calls match these filters.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(call => <CallCard key={call.id} call={call} showLead />)}
        </div>
      )}
    </div>
  )
}
