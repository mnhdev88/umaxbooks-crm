'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceCall } from '@/types'
import { formatDateTime, timeAgo } from '@/lib/utils'
import {
  Phone, PhoneOff, Voicemail, Calendar, PhoneCall, Globe, DollarSign,
  UserCheck, MessageSquare, Play, FileText, ChevronDown, ChevronRight, Ban,
} from 'lucide-react'

interface CallsTabProps {
  leadId: string
}

const INTEREST_STYLE: Record<string, { cls: string; label: string }> = {
  yes:   { cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40', label: 'Interested' },
  maybe: { cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40',       label: 'Maybe' },
  no:    { cls: 'bg-red-900/30 text-red-400 border-red-800/40',             label: 'Not interested' },
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

function CallCard({ call }: { call: VoiceCall }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const interest = call.interested ? INTEREST_STYLE[call.interested] : null

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-3">
      {/* Header: date + answered-by + interest */}
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

export function CallsTab({ leadId }: CallsTabProps) {
  const [calls, setCalls] = useState<VoiceCall[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    let active = true

    async function fetchCalls() {
      const { data } = await supabase
        .from('voice_calls')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
      if (active && data) setCalls(data as VoiceCall[])
      if (active) setLoading(false)
    }
    fetchCalls()

    // Live-update when the webhook saves a new call.
    const channel = supabase
      .channel(`voice-calls-${leadId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'voice_calls',
        filter: `lead_id=eq.${leadId}`,
      }, () => { fetchCalls() })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  }, [leadId])

  if (loading) {
    return <div className="text-center py-12 text-slate-500 text-sm">Loading calls…</div>
  }
  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        No AI calls yet. Use the “AI Call” button to place one — results appear here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {calls.map(call => <CallCard key={call.id} call={call} />)}
    </div>
  )
}
