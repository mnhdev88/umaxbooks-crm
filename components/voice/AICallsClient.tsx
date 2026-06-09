'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { VoiceCall } from '@/types'
import { formatDateTime, timeAgo } from '@/lib/utils'
import {
  Phone, PhoneOff, Voicemail, Calendar, PhoneCall, Globe, DollarSign,
  UserCheck, MessageSquare, Play, FileText, ChevronDown, ChevronRight, Ban,
  Building2, ExternalLink, Search,
} from 'lucide-react'

/** voice_calls row joined with a slim lead record for the global view. */
export interface VoiceCallWithLead extends VoiceCall {
  lead: {
    id: string
    name: string | null
    company_name: string | null
    lead_number: number | null
    phone: string | null
  } | null
}

const INTEREST_STYLE: Record<string, { cls: string; label: string }> = {
  yes:   { cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40', label: 'Interested' },
  maybe: { cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40',       label: 'Maybe' },
  no:    { cls: 'bg-red-900/30 text-red-400 border-red-800/40',             label: 'Not interested' },
}

type FilterKey = 'all' | 'interested' | 'appointments' | 'callbacks' | 'voicemail' | 'dnc'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'interested',   label: 'Interested' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'callbacks',    label: 'Callbacks' },
  { key: 'voicemail',    label: 'Voicemail' },
  { key: 'dnc',          label: 'Do not call' },
]

function matchesFilter(call: VoiceCall, f: FilterKey): boolean {
  switch (f) {
    case 'interested':   return call.interested === 'yes' || call.interested === 'maybe'
    case 'appointments': return !!call.appointment_booked
    case 'callbacks':    return !!call.callback_requested
    case 'voicemail':    return call.answered_by === 'voicemail'
    case 'dnc':          return !!call.do_not_call
    default:             return true
  }
}

/** A single key/value fact row — only renders when there's a value worth showing. */
function Fact({ icon: Icon, label, value, iconCls = 'text-orange-400' }: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  iconCls?: string
}) {
  if (value === null || value === undefined || value === '' || value === false) return null
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon size={12} className={`flex-shrink-0 mt-0.5 ${iconCls}`} />
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-200 break-words">{value === true ? 'Yes' : value}</span>
    </div>
  )
}

function AnsweredBadge({ answeredBy }: { answeredBy: string | null }) {
  if (answeredBy === 'human') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-blue-900/30 text-blue-400 border-blue-800/40">
        <Phone size={11} /> Human
      </span>
    )
  }
  if (answeredBy === 'voicemail') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-slate-800 text-slate-400 border-slate-700">
        <Voicemail size={11} /> Voicemail
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-slate-800 text-slate-500 border-slate-700">
      <PhoneOff size={11} /> {answeredBy || 'Unknown'}
    </span>
  )
}

function CallCard({ call }: { call: VoiceCallWithLead }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const interest = call.interested ? INTEREST_STYLE[call.interested] : null
  const lead = call.lead
  const leadName = lead?.company_name || lead?.name || 'Unknown lead'

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-3">
      {/* Lead header — links straight to that lead's AI Calls tab */}
      {lead ? (
        <Link
          href={`/leads/${lead.id}?tab=calls`}
          className="group flex items-center gap-2 -m-1 p-1 rounded-lg hover:bg-slate-700/40 transition-colors"
        >
          <Building2 size={14} className="text-orange-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-100 group-hover:text-orange-300 truncate">
            {leadName}
          </span>
          {lead.lead_number && (
            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 shrink-0">
              NVL-{String(lead.lead_number).padStart(3, '0')}
            </span>
          )}
          {lead.phone && <span className="text-[11px] text-slate-500 truncate">{lead.phone}</span>}
          <ExternalLink size={11} className="text-slate-600 group-hover:text-orange-300 shrink-0 ml-auto" />
        </Link>
      ) : (
        <div className="flex items-center gap-2">
          <Building2 size={14} className="text-slate-600 shrink-0" />
          <span className="text-sm font-semibold text-slate-400">Unlinked call</span>
        </div>
      )}

      {/* Header: type + answered-by + interest */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <PhoneCall size={14} className="text-indigo-400" />
          <span className="text-sm font-semibold text-slate-200">AI Voice Call</span>
          <AnsweredBadge answeredBy={call.answered_by} />
          {interest && (
            <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${interest.cls}`}>
              {interest.label}
            </span>
          )}
          {call.do_not_call && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-red-900/30 text-red-400 border-red-800/40">
              <Ban size={11} /> Do not call
            </span>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-[10px] text-slate-400">{formatDateTime(call.created_at)}</p>
          <p className="text-[10px] text-slate-600">
            {timeAgo(call.created_at)}
            {typeof call.call_length_min === 'number' ? ` · ${call.call_length_min.toFixed(1)} min` : ''}
          </p>
        </div>
      </div>

      {/* Bland's own summary */}
      {call.summary && (
        <p className="text-xs text-slate-400 leading-relaxed">{call.summary}</p>
      )}

      {/* Structured facts extracted from the caller */}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
        <Fact icon={Calendar} label="Appointment:" iconCls="text-emerald-400"
          value={call.appointment_booked ? (call.appointment_time || 'Booked') : false} />
        <Fact icon={PhoneCall} label="Callback:" iconCls="text-amber-400"
          value={call.callback_requested ? (call.callback_time || 'Requested') : false} />
        <Fact icon={Globe} label="Has website:"
          value={call.has_website === null ? false : (call.current_website || (call.has_website ? 'Yes' : 'No'))} />
        <Fact icon={DollarSign} label="Budget:" iconCls="text-emerald-400" value={call.budget_mentioned} />
        <Fact icon={UserCheck} label="Decision maker:" iconCls="text-blue-400"
          value={call.decision_maker === null ? false : (call.decision_maker ? 'Yes' : 'No')} />
        <Fact icon={MessageSquare} label="Objection:" iconCls="text-red-400" value={call.objection} />
      </div>

      {call.notes && (
        <p className="text-xs text-slate-400 italic border-l-2 border-slate-700 pl-2">{call.notes}</p>
      )}

      {/* Recording + transcript */}
      <div className="flex items-center gap-4 pt-1">
        {call.recording_url && (
          <a href={call.recording_url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
            <Play size={12} /> Recording
          </a>
        )}
        {call.transcript && (
          <button onClick={() => setShowTranscript(v => !v)}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
            {showTranscript ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FileText size={12} /> Transcript
          </button>
        )}
      </div>
      {showTranscript && call.transcript && (
        <pre className="text-[11px] text-slate-400 whitespace-pre-wrap bg-slate-900/60 rounded-lg p-3 max-h-72 overflow-y-auto border border-slate-700/50">
          {call.transcript}
        </pre>
      )}
    </div>
  )
}

function StatChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 min-w-[120px]">
      <p className={`text-2xl font-bold ${cls}`}>{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

export function AICallsClient({ initialCalls }: { initialCalls: VoiceCallWithLead[] }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')

  const stats = useMemo(() => ({
    total:        initialCalls.length,
    interested:   initialCalls.filter(c => c.interested === 'yes' || c.interested === 'maybe').length,
    appointments: initialCalls.filter(c => c.appointment_booked).length,
    callbacks:    initialCalls.filter(c => c.callback_requested).length,
    dnc:          initialCalls.filter(c => c.do_not_call).length,
  }), [initialCalls])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return initialCalls.filter(c => {
      if (!matchesFilter(c, filter)) return false
      if (!q) return true
      const hay = [
        c.lead?.company_name, c.lead?.name, c.lead?.phone,
        c.summary, c.notes, c.objection,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [initialCalls, filter, query])

  return (
    <div className="p-6 space-y-5">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-3">
        <StatChip label="Total calls"  value={stats.total}        cls="text-slate-100" />
        <StatChip label="Interested"   value={stats.interested}   cls="text-emerald-400" />
        <StatChip label="Appointments" value={stats.appointments} cls="text-emerald-400" />
        <StatChip label="Callbacks"    value={stats.callbacks}    cls="text-amber-400" />
        <StatChip label="Do not call"  value={stats.dnc}          cls="text-red-400" />
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                filter === f.key
                  ? 'bg-orange-500/15 text-orange-300 border-orange-500/40'
                  : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search lead, summary, objection…"
            className="w-64 max-w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-sm">
          {initialCalls.length === 0
            ? 'No AI calls yet. Place a call from any lead with the “AI Call” button — results show up here.'
            : 'No calls match this filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(call => <CallCard key={call.id} call={call} />)}
        </div>
      )}
    </div>
  )
}
