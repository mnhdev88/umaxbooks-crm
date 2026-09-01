'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VoiceCall } from '@/types'
import { formatDateTime, timeAgo } from '@/lib/utils'
import {
  Phone, PhoneCall, PhoneOff, Voicemail, Ban, Loader2, X,
  User, Calendar, MessageSquare, Delete, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'

/** voice_calls row with the resolved agent name (dialer calls only). */
type CallWithAgent = VoiceCall & { agent?: { full_name: string | null } | null }

/** One of our outbound numbers, as offered in the "Call from" dropdown. */
interface CallerOption {
  id: string
  phone_number: string
  label: string | null
  daily_cap: number
  inbound_mode: 'full' | 'deflect'
  /** FALSE = offered here but never chosen by "Auto" (108). */
  auto_rotate: boolean
}

/** +19086395666 → +1 908 639 5666. Left as-is for anything not US E.164. */
function prettyNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164
}

/**
 * Pre-call confirmation popup shared by the dialer ("Call") and AI ("AI Call") buttons.
 *
 * On open it loads this lead's last 5 calls so the agent can review recent history before
 * dialing. For browser ("dialer") calls it also shows a "Call from" dropdown and an editable
 * number + keypad, pre-filled with the lead's phone, so the agent can dial an alternate
 * number for this lead. "Call" runs the caller-supplied action with the number to dial and
 * the chosen caller ID; "Do not call" flags the lead (leads.do_not_call = true) and closes
 * without dialing.
 */
export function PreCallModal({
  open,
  leadId,
  phone,
  altPhones,
  name,
  callType,
  onConfirm,
  onClose,
}: {
  open: boolean
  leadId: string
  phone?: string | null
  /** Additional numbers on file (leads.alt_phones) — shown as pick-a-number chips. */
  altPhones?: { value: string; label?: string }[] | null
  name?: string | null
  callType: 'dialer' | 'ai'
  /**
   * Receives the number the agent chose to dial (the editable field, or the lead's phone),
   * and the caller_numbers id to call from — undefined when left on "Auto".
   */
  onConfirm: (dialNumber: string, callerNumberId?: string) => void
  onClose: () => void
}) {
  const [calls, setCalls] = useState<CallWithAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [flagging, setFlagging] = useState(false)
  const [dialNumber, setDialNumber] = useState('')
  // Our outbound numbers + how many calls each has placed today, for the "Call from" picker.
  const [callerOptions, setCallerOptions] = useState<CallerOption[]>([])
  const [usedToday, setUsedToday] = useState<Record<string, number>>({})
  // '' = Auto. Deliberately reset on every open (see the effect below): letting a manual
  // pick persist is how one number ends up placing the whole day's volume and gets
  // spam-flagged, which is the problem the rotating pool exists to solve.
  const [callerNumberId, setCallerNumberId] = useState('')
  // History is reference-only, so it starts collapsed to keep the Call button in view.
  const [showHistory, setShowHistory] = useState(false)
  const supabase = createClient()

  // Every number on file: primary first, then the alternates.
  const numbers = [
    ...(phone ? [{ value: phone, label: 'Primary' }] : []),
    ...(altPhones || []).filter(p => p.value?.trim()),
  ]

  // Reset the dial field to the lead's number, drop back to the automatic caller ID, and
  // collapse history, each time the modal opens.
  useEffect(() => {
    if (open) {
      setDialNumber(phone || altPhones?.[0]?.value || '')
      setCallerNumberId('')
      setShowHistory(false)
    }
  }, [open, phone])

  // Load the caller-ID pool. Refetched per open so today's counts (and any number an
  // admin just deactivated) are current; a failure is silent and simply leaves the
  // dropdown on Auto, which is the server's default behaviour anyway.
  useEffect(() => {
    if (!open || callType !== 'dialer') return
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/dialer/caller-options')
        if (!res.ok) return
        const data = await res.json()
        if (!active) return
        setCallerOptions((data.numbers || []) as CallerOption[])
        setUsedToday((data.usedToday || {}) as Record<string, number>)
      } catch {
        // Auto-select still works — nothing to tell the agent.
      }
    })()
    return () => { active = false }
  }, [open, callType])

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('voice_calls')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(5)
      if (!active) return
      const rows = (data as VoiceCall[]) || []

      // Resolve dialer-call agent names (FK targets auth.users, so map via profiles).
      const agentIds = [...new Set(rows.map((c) => c.agent_user_id).filter(Boolean))] as string[]
      let agents: Record<string, { full_name: string | null }> = {}
      if (agentIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', agentIds)
        agents = Object.fromEntries((profiles || []).map((p: any) => [p.id, { full_name: p.full_name }]))
      }
      if (!active) return
      setCalls(rows.map((c) => ({
        ...c,
        agent: c.agent_user_id ? agents[c.agent_user_id] ?? null : null,
      })))
      setLoading(false)
    })()
    return () => { active = false }
  }, [open, leadId])

  if (!open) return null

  async function handleDoNotCall() {
    setFlagging(true)
    const { error } = await supabase
      .from('leads')
      .update({ do_not_call: true })
      .eq('id', leadId)
    setFlagging(false)
    if (error) {
      toast.error(error.message || 'Could not flag this lead.')
      return
    }
    toast.success('Lead marked “Do not call”.')
    onClose()
  }

  function handleCall() {
    // AI calls dial the lead server-side (leadId only); browser calls use the editable field.
    const number = callType === 'ai' ? (phone || '') : dialNumber.trim()
    if (!number) return
    // '' (Auto) is sent as undefined so the server runs its normal rotation.
    onConfirm(number, callType === 'dialer' ? callerNumberId || undefined : undefined)
    onClose()
  }

  const title = callType === 'ai' ? 'Place AI voice call' : 'Call this lead'
  const canCall = callType === 'ai' ? !!phone : !!dialNumber.trim()

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Confirm call"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border border-slate-700 bg-[#0E0B24] p-5 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">{title}</p>
            <p className="truncate text-xs text-slate-400">{name || phone || 'Lead'}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable middle so the footer (Call / Do not call) stays pinned and always visible. */}
        <div className="-mx-1 mt-1 flex-1 overflow-y-auto px-1">
        {callType === 'dialer' && callerOptions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Call from
            </p>
            <select
              value={callerNumberId}
              onChange={(e) => setCallerNumberId(e.target.value)}
              aria-label="Number to call from"
              className="w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm
                         font-medium text-slate-100 focus:border-orange-500/60 focus:outline-none"
            >
              <option value="">Auto — best available number</option>
              {callerOptions.map((o) => {
                const used = usedToday[o.phone_number] || 0
                const atCap = used >= o.daily_cap
                return (
                  <option key={o.id} value={o.id}>
                    {o.label ? `${o.label} · ` : ''}
                    {prettyNumber(o.phone_number)}
                    {` · ${used}/${o.daily_cap} today`}
                    {o.auto_rotate ? '' : ' · manual only'}
                    {atCap ? ' ⚠ at cap' : ''}
                  </option>
                )
              })}
            </select>
            {(() => {
              if (!callerNumberId) {
                return (
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    Rotates across our numbers and prefers the lead&rsquo;s area code.
                  </p>
                )
              }
              const picked = callerOptions.find((o) => o.id === callerNumberId)
              if (!picked) return null
              const used = usedToday[picked.phone_number] || 0
              // Two distinct warnings, both worth surfacing before the call connects.
              return (
                <div className="mt-1.5 space-y-0.5">
                  {used >= picked.daily_cap && (
                    <p className="text-[10px] text-amber-400/80">
                      This number is at its daily cap ({used}/{picked.daily_cap}). Calling anyway
                      raises the risk it gets flagged as spam.
                    </p>
                  )}
                  {!picked.auto_rotate && (
                    <p className="text-[10px] text-slate-500">
                      Kept out of the automatic rotation — it only carries calls an agent
                      picks it for.
                    </p>
                  )}
                  {picked.inbound_mode === 'deflect' && (
                    <p className="text-[10px] text-amber-400/80">
                      Outbound-only line — if the lead calls back, they hear a redirect message
                      instead of reaching an agent.
                    </p>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {callType === 'dialer' && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Number to dial
            </p>
            {numbers.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {numbers.map((n) => (
                  <button
                    key={n.value}
                    type="button"
                    onClick={() => setDialNumber(n.value)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      dialNumber.trim() === n.value.trim()
                        ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                        : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {n.label ? `${n.label}: ` : ''}{n.value}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                inputMode="tel"
                placeholder="Enter a number"
                aria-label="Number to dial"
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm
                           font-medium tracking-wide text-slate-100 placeholder:text-slate-600
                           focus:border-orange-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setDialNumber((n) => n.slice(0, -1))}
                disabled={!dialNumber}
                aria-label="Backspace"
                className="rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors
                           hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Delete size={16} />
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDialNumber((n) => n + k)}
                  className="rounded-lg border border-slate-700 bg-slate-900/40 py-2 text-base font-semibold
                             text-slate-200 transition-colors hover:bg-slate-800 active:bg-slate-700"
                >
                  {k}
                </button>
              ))}
            </div>
            {numbers.length > 0 && dialNumber.trim() && !numbers.some((n) => n.value.trim() === dialNumber.trim()) && (
              <p className="mt-1.5 text-[10px] text-amber-400/80">
                Dialing a number other than the ones on file for this lead.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          className="mt-4 mb-2 flex w-full items-center gap-1.5 text-[11px] font-semibold uppercase
                     tracking-wide text-slate-500 transition-colors hover:text-slate-300"
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${showHistory ? '' : '-rotate-90'}`}
          />
          Last 5 calls
          {!loading && calls.length > 0 && (
            <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              {calls.length}
            </span>
          )}
        </button>

        {showHistory && (
          loading ? (
            <div className="py-6 text-center text-xs text-slate-500">Loading history…</div>
          ) : calls.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 py-6 text-center text-xs text-slate-500">
              No previous calls for this lead.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {calls.map((c) => (
                <CallRow key={c.id} call={c} />
              ))}
            </ul>
          )
        )}
        </div>

        <div className="mt-4 flex shrink-0 items-center justify-between gap-2">
          <button
            onClick={handleDoNotCall}
            disabled={flagging}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5
                       text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {flagging ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
            Do not call
          </button>
          <button
            onClick={handleCall}
            disabled={flagging || !canCall}
            className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white
                       transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {callType === 'ai' ? <PhoneCall size={13} /> : <Phone size={13} />}
            Call
          </button>
        </div>
      </div>
    </div>
  )
}

const INTEREST_LABEL: Record<string, { label: string; cls: string }> = {
  yes:   { label: 'Interested',     cls: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/40' },
  maybe: { label: 'Maybe',          cls: 'bg-amber-900/30 text-amber-400 border-amber-800/40' },
  no:    { label: 'Not interested', cls: 'bg-red-900/30 text-red-400 border-red-800/40' },
}

function duration(call: VoiceCall): string | null {
  if (typeof call.duration_sec === 'number') {
    const m = Math.floor(call.duration_sec / 60)
    const s = call.duration_sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  if (typeof call.call_length_min === 'number') return `${call.call_length_min.toFixed(1)} min`
  return null
}

/** Rich summary of one past call for the pre-call review list. */
function CallRow({ call }: { call: CallWithAgent }) {
  const isDialer = call.provider === 'twilio'
  const interest = call.interested ? INTEREST_LABEL[call.interested] : null
  const dur = duration(call)
  const summary = call.summary || call.notes
  const callback = call.callback_requested ? (call.callback_time || 'Callback requested') : null
  const appointment = call.appointment_booked ? (call.appointment_time || 'Appointment booked') : null

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5 text-xs">
      {/* Line 1: type · status · duration + outcome tag */}
      <div className="flex items-center gap-2">
        {isDialer ? (
          <Phone size={13} className="shrink-0 text-emerald-400" />
        ) : (
          <PhoneCall size={13} className="shrink-0 text-indigo-400" />
        )}
        <span className="font-semibold text-slate-200">{isDialer ? 'Dialer call' : 'AI call'}</span>
        {call.status && <span className="text-slate-500">· {call.status.replace(/-/g, ' ')}</span>}
        {dur && <span className="text-slate-500">· {dur}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {call.answered_by === 'voicemail' && <Voicemail size={12} className="text-slate-500" />}
          {call.status === 'no-answer' && <PhoneOff size={12} className="text-slate-500" />}
          {call.do_not_call && <Ban size={12} className="text-red-400" />}
          {interest && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${interest.cls}`}>
              {interest.label}
            </span>
          )}
        </div>
      </div>

      {/* Line 2: timestamp + who called */}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
        <span>{formatDateTime(call.created_at)} · {timeAgo(call.created_at)}</span>
        {isDialer && call.agent?.full_name && (
          <span className="inline-flex items-center gap-1">
            <User size={10} /> {call.agent.full_name}
          </span>
        )}
      </div>

      {/* Callback / appointment hints */}
      {(callback || appointment) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
          {appointment && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Calendar size={10} /> {appointment}
            </span>
          )}
          {callback && (
            <span className="inline-flex items-center gap-1 text-amber-400">
              <PhoneCall size={10} /> {callback}
            </span>
          )}
        </div>
      )}

      {/* Summary / notes */}
      {summary && (
        <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-slate-400">
          <MessageSquare size={11} className="mt-0.5 shrink-0 text-slate-600" />
          <span className="line-clamp-2">{summary}</span>
        </p>
      )}
    </li>
  )
}
