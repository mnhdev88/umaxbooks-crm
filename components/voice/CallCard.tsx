'use client'

import { useState } from 'react'
import Link from 'next/link'
import { VoiceCall } from '@/types'
import { formatDateTime, timeAgo } from '@/lib/utils'
import {
  Phone, PhoneOff, Voicemail, Calendar, PhoneCall, Globe, DollarSign,
  UserCheck, MessageSquare, FileText, ChevronDown, ChevronRight, Ban,
  Building2, ExternalLink, User, PhoneIncoming,
} from 'lucide-react'
import { RecordingPlayer } from './RecordingPlayer'

/** voice_calls row plus the optional joined lead used by the global Calls view. */
export interface VoiceCallWithLead extends VoiceCall {
  lead?: {
    id: string
    name: string | null
    company_name: string | null
    lead_number: number | null
    phone: string | null
    assigned_agent_id?: string | null
  } | null
}

const INTEREST_STYLE: Record<string, { cls: string; label: string }> = {
  yes:   { cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40', label: 'Interested' },
  maybe: { cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40',       label: 'Maybe' },
  no:    { cls: 'bg-red-900/30 text-red-400 border-red-800/40',             label: 'Not interested' },
}

// Twilio DialCallStatus → badge styling.
const STATUS_STYLE: Record<string, string> = {
  completed:  'bg-emerald-900/30 text-emerald-400 border-emerald-800/40',
  'no-answer':'bg-slate-800 text-slate-400 border-slate-700',
  busy:       'bg-amber-900/30 text-amber-400 border-amber-800/40',
  failed:     'bg-red-900/30 text-red-400 border-red-800/40',
  canceled:   'bg-slate-800 text-slate-500 border-slate-700',
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

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const cls = STATUS_STYLE[status] || 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${cls}`}>
      <Phone size={11} /> {status.replace(/-/g, ' ')}
    </span>
  )
}

function fmtDuration(call: VoiceCall): string | null {
  if (typeof call.duration_sec === 'number') {
    const m = Math.floor(call.duration_sec / 60)
    const s = call.duration_sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  if (typeof call.call_length_min === 'number') return `${call.call_length_min.toFixed(1)} min`
  return null
}

/**
 * How an inbound call ended (migration 092). Green where we actually spoke to them.
 *
 * The '-closed' variants (098) are calls that arrived outside working hours and went
 * straight to the recorder. They're amber, not red: nobody missed anything, so they
 * shouldn't read as a failure on the agent's timeline.
 */
const INBOUND_STYLE: Record<string, { label: string; cls: string }> = {
  'answered-owner':    { label: 'Answered',         cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' },
  'answered-hunt':     { label: 'Answered by team', cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' },
  voicemail:           { label: 'Left voicemail',   cls: 'bg-sky-900/30 text-sky-400 border-sky-800/40' },
  abandoned:           { label: 'Missed',           cls: 'bg-red-900/30 text-red-400 border-red-800/40' },
  'voicemail-closed':  { label: 'Voicemail (after hours)', cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40' },
  'abandoned-closed':  { label: 'After hours',      cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40' },
}

/**
 * `agent` is whoever answered (the incoming route records the leg that connected, not
 * the owner it rang first). We name them in the badge itself — "Answered by team" made a
 * manager open the card to find out who to ask. The generic labels above stay as the
 * fallback for rows where the agent is unknown.
 */
function InboundBadge({ outcome, agent }: { outcome: string | null; agent?: string | null }) {
  if (!outcome) return null
  const s = INBOUND_STYLE[outcome] || { label: outcome, cls: 'bg-slate-800 text-slate-400 border-slate-700' }
  const label = agent && outcome.startsWith('answered') ? `Answered by ${agent}` : s.label
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${s.cls}`}>
      {label}
    </span>
  )
}

/**
 * One call in a list — provider- and direction-aware. Renders human Twilio dialer calls
 * ("Dialer Call — by Agent", dial status, duration), inbound callbacks ("Incoming Call",
 * how it was resolved) and Bland AI calls ("AI Voice Call", extracted facts, transcript).
 * Pass showLead for the global view's lead header.
 */
export function CallCard({ call, showLead = false }: { call: VoiceCallWithLead; showLead?: boolean }) {
  const [showTranscript, setShowTranscript] = useState(false)
  // Inbound is checked first: those rows are provider='twilio' too, so testing the
  // provider alone would render a callback as an outbound "Dialer Call".
  const isInbound = call.direction === 'inbound'
  const isDialer = call.provider === 'twilio' && !isInbound
  const interest = call.interested ? INTEREST_STYLE[call.interested] : null
  const duration = fmtDuration(call)
  const lead = call.lead
  const leadName = lead?.company_name || lead?.name || 'Unknown lead'
  // Answered inbound calls carry the answerer's name in the badge, so the only name left
  // to show is the lead's owner — and only when it isn't the same person, which it isn't
  // whenever the hunt group picked up a colleague's lead. On an unanswered call nobody
  // answered, so call.agent is the owner we rang and notified: use it as the fallback.
  const answeredInbound = isInbound && !!call.inbound_outcome?.startsWith('answered')
  const answerer = answeredInbound ? call.agent?.full_name ?? null : null
  const ownerName = call.owner?.full_name ?? (answeredInbound ? null : call.agent?.full_name ?? null)

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-3">
      {/* Lead header (global view only) — links to that lead's Calls tab */}
      {showLead && (lead ? (
        <Link
          href={`/leads/${lead.id}?tab=${call.provider === 'twilio' ? 'appointments' : 'calls'}`}
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
      ))}

      {/* Header: type + status + interest */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {isInbound ? (
            <>
              <PhoneIncoming size={14} className="text-sky-400" />
              <span className="text-sm font-semibold text-slate-200">Incoming Call</span>
              <InboundBadge outcome={call.inbound_outcome} agent={call.agent?.full_name} />
            </>
          ) : isDialer ? (
            <>
              <Phone size={14} className="text-emerald-400" />
              <span className="text-sm font-semibold text-slate-200">Dialer Call</span>
              <StatusBadge status={call.status} />
            </>
          ) : (
            <>
              <PhoneCall size={14} className="text-indigo-400" />
              <span className="text-sm font-semibold text-slate-200">AI Voice Call</span>
              <AnsweredBadge answeredBy={call.answered_by} />
            </>
          )}
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
            {timeAgo(call.created_at)}{duration ? ` · ${duration}` : ''}
          </p>
        </div>
      </div>

      {/* Who placed it (dialer) / who took it (inbound) */}
      {isDialer && call.agent?.full_name && (
        <Fact icon={User} label="Called by:" iconCls="text-emerald-400" value={call.agent.full_name} />
      )}
      {isInbound && (
        <>
          {call.from_number && (
            <Fact icon={PhoneIncoming} label="From:" iconCls="text-sky-400" value={call.from_number} />
          )}
          {call.to_number && (
            <Fact icon={Phone} label="Rang:" iconCls="text-slate-500" value={call.to_number} />
          )}
          {ownerName && ownerName !== answerer && (
            <Fact icon={User} label="Lead owner:" iconCls="text-sky-400" value={ownerName} />
          )}
        </>
      )}

      {/* Bland's own summary */}
      {call.summary && (
        <p className="text-xs text-slate-400 leading-relaxed">{call.summary}</p>
      )}

      {/* Structured facts (Bland extraction; hidden when absent) */}
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
      {(call.recording_url || call.transcript) && (
        <div className="flex items-center gap-4 pt-1 flex-wrap">
          {call.recording_url && (
            <RecordingPlayer url={call.recording_url} provider={call.provider} durationSec={call.duration_sec} />
          )}
          {call.transcript && (
            <button onClick={() => setShowTranscript(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              {showTranscript ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <FileText size={12} /> Transcript
            </button>
          )}
        </div>
      )}
      {showTranscript && call.transcript && (
        <pre className="text-[11px] text-slate-400 whitespace-pre-wrap bg-slate-900/60 rounded-lg p-3 max-h-72 overflow-y-auto border border-slate-700/50">
          {call.transcript}
        </pre>
      )}
    </div>
  )
}
