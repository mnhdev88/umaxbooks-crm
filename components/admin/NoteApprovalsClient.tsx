'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import {
  CheckCircle2, XCircle, Clock, Building2, ExternalLink,
  MessageSquare, Send, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NoteApproval {
  id: string
  lead_id: string
  note: string
  created_at: string
  approval_status: 'pending' | 'approved' | 'declined'
  decline_reason: string | null
  reviewed_at: string | null
  author: { id: string; full_name: string | null; role: string | null } | null
  reviewer: { full_name: string | null } | null
  lead: { id: string; company_name: string | null; name: string | null; slug: string | null; status: string | null; website_url: string | null } | null
  /** The manager note that was sent to the developer, if this request was approved. */
  manager_note: string | null
}

interface Props {
  initialApprovals: NoteApproval[]
  userId: string
}

const STATUS_CLS = {
  pending:  'bg-amber-900/40 text-amber-300 border-amber-800/50',
  approved: 'bg-green-900/40 text-green-300 border-green-800/50',
  declined: 'bg-red-900/40 text-red-300 border-red-800/50',
}

const STATUS_ICON = { pending: Clock, approved: CheckCircle2, declined: XCircle }

export function NoteApprovalsClient({ initialApprovals, userId }: Props) {
  const supabase = createClient()
  const [approvals, setApprovals] = useState(initialApprovals)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending')
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [devNotes, setDevNotes] = useState<Record<string, string>>({})
  const [declineNotes, setDeclineNotes] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [declineOpen, setDeclineOpen] = useState<Record<string, boolean>>({})

  const filtered = filter === 'all' ? approvals : approvals.filter(a => a.approval_status === filter)
  const pendingCount = approvals.filter(a => a.approval_status === 'pending').length

  /** Approve: post the MANAGER's own note to the developer thread and open the Dev Queue. */
  async function approve(a: NoteApproval) {
    const note = (devNotes[a.id] || '').trim()
    if (!note) {
      setErrors(p => ({ ...p, [a.id]: 'Write the note you want the developer to receive.' }))
      return
    }
    setErrors(p => ({ ...p, [a.id]: '' }))
    setActioningId(a.id)

    try {
      // 1. Mark the agent's request approved.
      await supabase
        .from('audit_notes')
        .update({ approval_status: 'approved', reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq('id', a.id)

      // 2. Post the manager's own note — this is what the developer sees.
      //    The DB trigger stamps it 'approved' because the author is a manager.
      await supabase.from('audit_notes').insert({
        lead_id: a.lead_id,
        user_id: userId,
        note,
        source_note_id: a.id,
      })

      const company = a.lead?.company_name || a.lead?.name || 'Lead'
      const preview = note.slice(0, 120) + (note.length > 120 ? '…' : '')

      // 3. Now — and only now — the lead enters the Dev Queue.
      const EARLY_STAGES = new Set(['New', 'Contacted', 'Callback Booked'])
      const promoted = !!a.lead?.status && EARLY_STAGES.has(a.lead.status)
      if (promoted) {
        await supabase
          .from('leads')
          .update({ status: 'Audit Ready', updated_at: new Date().toISOString() })
          .eq('id', a.lead_id)
      }

      // 4. Notify every developer.
      const { data: devs } = await supabase.from('profiles').select('id').eq('role', 'developer')
      if (devs?.length) {
        await supabase.from('notifications').insert(
          devs.map(d => ({
            user_id: d.id,
            lead_id: a.lead_id,
            title: `${promoted ? '🟡 Audit Ready — ' : ''}Manager Note — ${company}`,
            message: preview,
            type: 'info',
          }))
        )
      }

      // 5. Tell the agent their note cleared.
      if (a.author?.id && a.author.id !== userId) {
        await supabase.from('notifications').insert({
          user_id: a.author.id,
          lead_id: a.lead_id,
          title: `✅ Note Approved — ${company}`,
          message: 'Your manager reviewed your note and briefed the developer.',
          type: 'info',
        })
      }

      await supabase.from('activity_logs').insert({
        lead_id: a.lead_id,
        user_id: userId,
        action: 'Audit Note Approved',
        details: `Approved ${a.author?.full_name || 'agent'}'s note; developer briefed.`,
      })

      setApprovals(prev => prev.map(x => x.id === a.id
        ? { ...x, approval_status: 'approved' as const, reviewed_at: new Date().toISOString(), manager_note: note }
        : x
      ))
    } finally {
      setActioningId(null)
    }
  }

  async function decline(a: NoteApproval) {
    const reason = (declineNotes[a.id] || '').trim()
    if (!reason) {
      setErrors(p => ({ ...p, [a.id]: 'Give the agent a reason for the decline.' }))
      return
    }
    setErrors(p => ({ ...p, [a.id]: '' }))
    setActioningId(a.id)

    try {
      await supabase
        .from('audit_notes')
        .update({
          approval_status: 'declined',
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          decline_reason: reason,
        })
        .eq('id', a.id)

      const company = a.lead?.company_name || a.lead?.name || 'Lead'

      if (a.author?.id && a.author.id !== userId) {
        await supabase.from('notifications').insert({
          user_id: a.author.id,
          lead_id: a.lead_id,
          title: `❌ Note Declined — ${company}`,
          message: reason.slice(0, 120),
          type: 'info',
        })
      }

      await supabase.from('activity_logs').insert({
        lead_id: a.lead_id,
        user_id: userId,
        action: 'Audit Note Declined',
        details: `Reason: ${reason.slice(0, 100)}`,
      })

      setApprovals(prev => prev.map(x => x.id === a.id
        ? { ...x, approval_status: 'declined' as const, decline_reason: reason, reviewed_at: new Date().toISOString() }
        : x
      ))
      setDeclineOpen(p => ({ ...p, [a.id]: false }))
    } finally {
      setActioningId(null)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['pending', 'approved', 'declined', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors capitalize',
              filter === f
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-slate-200'
            )}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-900/60 text-amber-300 px-1.5 py-0.5 rounded-full text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl px-6 py-12 text-center">
          <MessageSquare size={28} className="text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">
            {filter === 'pending' ? 'No notes waiting for approval.' : `No ${filter} notes.`}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {filtered.map(a => {
          const Icon = STATUS_ICON[a.approval_status]
          const company = a.lead?.company_name || a.lead?.name || 'Unknown Lead'
          const busy = actioningId === a.id
          return (
            <div key={a.id} className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-700/60 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                    <Building2 size={15} className="text-orange-400" />
                  </div>
                  <div className="min-w-0">
                    {a.lead?.id ? (
                      <Link
                        href={`/leads/${a.lead.id}`}
                        className="text-sm font-semibold text-slate-100 hover:text-orange-400 transition-colors flex items-center gap-1.5"
                      >
                        {company} <ExternalLink size={11} className="flex-shrink-0" />
                      </Link>
                    ) : (
                      <p className="text-sm font-semibold text-slate-100">{company}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                      <User size={10} />
                      {a.author?.full_name || 'Sales Agent'}
                      {' · '}
                      {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' '}
                      {new Date(a.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      {a.lead?.status && <span className="text-slate-600">· {a.lead.status}</span>}
                    </p>
                  </div>
                </div>
                <span className={cn(
                  'text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border flex items-center gap-1 flex-shrink-0',
                  STATUS_CLS[a.approval_status]
                )}>
                  <Icon size={10} /> {a.approval_status}
                </span>
              </div>

              <div className="px-4 py-3 space-y-3">
                {/* The agent's note — context for the manager */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Agent&apos;s Note
                  </p>
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-900/60 border border-slate-700/60 rounded-lg px-3 py-2.5">
                    {a.note}
                  </p>
                </div>

                {a.approval_status === 'pending' && (
                  <>
                    {/* Manager writes their own note — this is what the dev gets */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Your Note to the Developer
                      </p>
                      <textarea
                        value={devNotes[a.id] ?? ''}
                        onChange={e => setDevNotes(p => ({ ...p, [a.id]: e.target.value }))}
                        placeholder="Write the brief the developer should receive — focus areas, priorities, scope…"
                        rows={3}
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Only this note reaches the developer. The agent&apos;s note above stays internal.
                      </p>
                    </div>

                    {declineOpen[a.id] && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Decline Reason
                        </p>
                        <textarea
                          value={declineNotes[a.id] ?? ''}
                          onChange={e => setDeclineNotes(p => ({ ...p, [a.id]: e.target.value }))}
                          placeholder="Tell the agent what to fix…"
                          rows={2}
                          className="w-full bg-slate-900/60 border border-red-800/40 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-red-500 resize-none"
                        />
                      </div>
                    )}

                    {errors[a.id] && (
                      <p className="text-xs text-red-400">{errors[a.id]}</p>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        onClick={() => approve(a)}
                        loading={busy && !declineOpen[a.id]}
                        disabled={busy}
                        className="bg-green-600 hover:bg-green-700 text-white border-0"
                      >
                        <Send size={13} /> Approve &amp; Send to Developer
                      </Button>
                      {declineOpen[a.id] ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => decline(a)}
                            loading={busy}
                            disabled={busy}
                            className="bg-red-600 hover:bg-red-700 text-white border-0"
                          >
                            <XCircle size={13} /> Confirm Decline
                          </Button>
                          <button
                            onClick={() => setDeclineOpen(p => ({ ...p, [a.id]: false }))}
                            className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { setDeclineOpen(p => ({ ...p, [a.id]: true })); setErrors(p => ({ ...p, [a.id]: '' })) }}
                          disabled={busy}
                          className="text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 px-3 py-2 rounded-lg border border-red-800/40 transition-colors disabled:opacity-50"
                        >
                          Decline
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Resolved states */}
                {a.approval_status === 'approved' && a.manager_note && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Note Sent to Developer
                    </p>
                    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap bg-cyan-900/15 border border-cyan-700/40 rounded-lg px-3 py-2.5">
                      {a.manager_note}
                    </p>
                  </div>
                )}

                {a.approval_status === 'declined' && a.decline_reason && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Decline Reason
                    </p>
                    <p className="text-sm text-red-300/90 leading-relaxed whitespace-pre-wrap bg-red-950/25 border border-red-800/40 rounded-lg px-3 py-2.5">
                      {a.decline_reason}
                    </p>
                  </div>
                )}

                {a.approval_status !== 'pending' && (
                  <p className="text-[11px] text-slate-500">
                    Reviewed by {a.reviewer?.full_name || 'a manager'}
                    {a.reviewed_at && ` · ${new Date(a.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
