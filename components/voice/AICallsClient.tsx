'use client'

import { useMemo, useState } from 'react'
import { VoiceCall } from '@/types'
import { Search } from 'lucide-react'
import { CallCard, type VoiceCallWithLead } from './CallCard'

// Re-export so the page (and any existing importers) keep their import path.
export type { VoiceCallWithLead } from './CallCard'

type OutcomeKey = 'all' | 'interested' | 'appointments' | 'callbacks' | 'voicemail' | 'dnc'

const OUTCOMES: { key: OutcomeKey; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'interested',   label: 'Interested' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'callbacks',    label: 'Callbacks' },
  { key: 'voicemail',    label: 'Voicemail' },
  { key: 'dnc',          label: 'Do not call' },
]

type ProviderKey = 'all' | 'twilio' | 'bland' | 'inbound'
const PROVIDERS: { key: ProviderKey; label: string }[] = [
  { key: 'all',     label: 'All calls' },
  { key: 'twilio',  label: 'Dialer' },
  { key: 'inbound', label: 'Incoming' },
  { key: 'bland',   label: 'AI' },
]

function matchesOutcome(call: VoiceCall, f: OutcomeKey): boolean {
  switch (f) {
    case 'interested':   return call.interested === 'yes' || call.interested === 'maybe'
    case 'appointments': return !!call.appointment_booked
    case 'callbacks':    return !!call.callback_requested
    case 'voicemail':    return call.answered_by === 'voicemail'
    case 'dnc':          return !!call.do_not_call
    default:             return true
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

export function AICallsClient({
  initialCalls,
  stats,
}: {
  initialCalls: VoiceCallWithLead[]
  stats: CallStats
}) {
  const [outcome, setOutcome] = useState<OutcomeKey>('all')
  const [provider, setProvider] = useState<ProviderKey>('all')
  const [agentId, setAgentId] = useState<string>('all')
  const [query, setQuery] = useState('')

  // The tiles describe every call; the list below holds only the most recent page of
  // them, and the filters run over that page. Say so when the two differ, rather than
  // letting "AI 249" sit above an empty list with no explanation.
  const truncated = stats.total > initialCalls.length

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
    return initialCalls.filter(c => {
      if (!matchesProvider(c, provider)) return false
      if (!matchesOutcome(c, outcome)) return false
      if (agentId !== 'all' && c.agent_user_id !== agentId) return false
      if (!q) return true
      const hay = [
        c.lead?.company_name, c.lead?.name, c.lead?.phone,
        c.summary, c.notes, c.objection, c.agent?.full_name,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [initialCalls, provider, outcome, agentId, query])

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

      {truncated && (
        <p className="text-xs text-slate-500 -mt-2">
          Totals above cover all {stats.total.toLocaleString()} calls. The list below shows
          the {initialCalls.length.toLocaleString()} most recent, and the filters apply to those.
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

      {/* Outcome filters + agent + search */}
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
            className="text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-orange-500"
          >
            <option value="all">All agents</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}

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
