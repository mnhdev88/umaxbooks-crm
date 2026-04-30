'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import {
  CheckCircle2, XCircle, Clock, Globe, MapPin,
  ExternalLink, Building2, Monitor,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ApprovalsClientProps {
  initialApprovals: any[]
  salesAgents: Profile[]
  userId: string
}

const STATUS_CLS = {
  pending:  'bg-amber-900/40 text-amber-300 border-amber-800/50',
  approved: 'bg-green-900/40 text-green-300 border-green-800/50',
  declined: 'bg-red-900/40 text-red-300 border-red-800/50',
}

const STATUS_ICON = {
  pending:  Clock,
  approved: CheckCircle2,
  declined: XCircle,
}

export function ApprovalsClient({ initialApprovals, salesAgents, userId }: ApprovalsClientProps) {
  const supabase = createClient()
  const [approvals, setApprovals] = useState(initialApprovals)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending')
  const [revisionNotes, setRevisionNotes] = useState<Record<string, string>>({})
  const [showDeclineFor, setShowDeclineFor] = useState<string | null>(null)

  const filtered = filter === 'all' ? approvals : approvals.filter(a => a.status === filter)
  const pendingCount = approvals.filter(a => a.status === 'pending').length

  async function approve(approval: any) {
    setActioningId(approval.id)

    await supabase
      .from('project_approvals')
      .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
      .eq('id', approval.id)

    // Lead stays "Demo Done" — sales agent notified to close the deal
    const assignedAgentId = approval.lead?.assigned_agent_id
    if (assignedAgentId) {
      await supabase.from('notifications').insert({
        user_id: assignedAgentId,
        lead_id: approval.lead_id,
        title: 'Demo Approved — Close the Deal',
        message: `${approval.lead?.company_name || 'A client'} demo has been approved. Time to close!`,
        type: 'info',
      })
    }

    await supabase.from('activity_logs').insert({
      lead_id: approval.lead_id,
      user_id: userId,
      action: 'Demo Approved',
      details: 'Admin approved the demo. Sales agent notified to close the deal.',
    })

    setApprovals(prev => prev.map(a => a.id === approval.id
      ? { ...a, status: 'approved', approved_by: userId }
      : a
    ))
    setActioningId(null)
  }

  async function decline(approval: any) {
    const notes = revisionNotes[approval.id] || ''
    setActioningId(approval.id)

    await supabase
      .from('project_approvals')
      .update({ status: 'declined', revision_notes: notes || null })
      .eq('id', approval.id)

    // Move lead back to Demo Scheduled so developer sees it again
    await supabase
      .from('leads')
      .update({ status: 'Demo Scheduled', updated_at: new Date().toISOString() })
      .eq('id', approval.lead_id)

    // Notify the developer who submitted the demo
    if (approval.developer_id) {
      await supabase.from('notifications').insert({
        user_id: approval.developer_id,
        lead_id: approval.lead_id,
        title: 'Demo Declined — Revision Required',
        message: notes
          ? `${approval.lead?.company_name || 'A client'} demo was declined: ${notes.slice(0, 80)}`
          : `${approval.lead?.company_name || 'A client'} demo was declined. Please revise and resubmit.`,
        type: 'info',
      })
    }

    await supabase.from('activity_logs').insert({
      lead_id: approval.lead_id,
      user_id: userId,
      action: 'Demo Declined',
      details: notes ? `Revision notes: ${notes}` : 'Demo declined by admin.',
    })

    setApprovals(prev => prev.map(a => a.id === approval.id
      ? { ...a, status: 'declined', revision_notes: notes }
      : a
    ))
    setShowDeclineFor(null)
    setActioningId(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-6 space-y-5">

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        {(['pending', 'approved', 'declined', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-full transition-colors capitalize',
              filter === f
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            )}
          >
            {f}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-orange-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500 text-sm">
          {filter === 'pending' ? 'No pending demo approvals.' : 'No records found.'}
        </div>
      )}

      <div className="space-y-4">
        {filtered.map(approval => {
          const lead = approval.lead
          const StatusIcon = STATUS_ICON[approval.status as keyof typeof STATUS_ICON] || Clock
          const isActioning = actioningId === approval.id
          const isDeclining = showDeclineFor === approval.id

          return (
            <div key={approval.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">

              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-900/30 border border-orange-800/40 flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} className="text-orange-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{lead?.company_name || '—'}</p>
                    <p className="text-xs text-slate-500">{lead?.name || ''}</p>
                  </div>
                </div>
                <span className={cn(
                  'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border capitalize',
                  STATUS_CLS[approval.status as keyof typeof STATUS_CLS] || STATUS_CLS.pending
                )}>
                  <StatusIcon size={11} />
                  {approval.status}
                </span>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {lead?.website_url && (
                  <a
                    href={lead.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 truncate"
                  >
                    <Globe size={12} className="flex-shrink-0" />
                    {lead.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    <ExternalLink size={10} className="flex-shrink-0" />
                  </a>
                )}
                {lead?.gmb_url && (
                  <a
                    href={lead.gmb_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-green-400 hover:text-green-300 truncate"
                  >
                    <MapPin size={12} className="flex-shrink-0" />
                    Google Business Profile
                    <ExternalLink size={10} className="flex-shrink-0" />
                  </a>
                )}
                {approval.created_at && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock size={12} className="text-amber-400 flex-shrink-0" />
                    Submitted: {formatDate(approval.created_at)}
                  </div>
                )}
              </div>

              {/* Demo URL */}
              {approval.demo_url && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Monitor size={14} className="text-orange-400 flex-shrink-0" />
                    <a
                      href={approval.demo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 truncate"
                    >
                      {approval.demo_url}
                    </a>
                  </div>
                  <a
                    href={approval.demo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                  >
                    Preview <ExternalLink size={11} />
                  </a>
                </div>
              )}

              {/* Revision notes (when declined) */}
              {approval.status === 'declined' && approval.revision_notes && (
                <div className="bg-red-900/15 border border-red-700/30 rounded-lg p-3">
                  <p className="text-xs font-semibold text-red-400 mb-1">Revision Notes</p>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap">{approval.revision_notes}</p>
                </div>
              )}

              {/* Actions */}
              {approval.status === 'pending' && (
                <div className="space-y-3 pt-1">
                  {isDeclining ? (
                    <div className="space-y-3">
                      <TextArea
                        label="Revision Notes for Developer"
                        rows={3}
                        value={revisionNotes[approval.id] || ''}
                        onChange={e => setRevisionNotes(prev => ({ ...prev, [approval.id]: e.target.value }))}
                        placeholder="Describe what needs to be changed or fixed…"
                      />
                      <div className="flex items-center gap-3">
                        <Button
                          size="sm"
                          onClick={() => decline(approval)}
                          loading={isActioning}
                          disabled={isActioning}
                          className="bg-red-600 hover:bg-red-500 text-white"
                        >
                          <XCircle size={13} /> Confirm Decline
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowDeclineFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        onClick={() => approve(approval)}
                        loading={isActioning}
                        disabled={isActioning}
                        className="bg-green-600 hover:bg-green-500 text-white"
                      >
                        <CheckCircle2 size={13} /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setShowDeclineFor(approval.id)}
                        disabled={isActioning}
                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      >
                        <XCircle size={13} /> Decline
                      </Button>
                      {lead?.id && (
                        <a
                          href={`/leads/${lead.id}`}
                          className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-orange-400 transition-colors"
                        >
                          View Lead <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {approval.status !== 'pending' && lead?.id && (
                <div className="pt-1">
                  <a
                    href={`/leads/${lead.id}`}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-orange-400 transition-colors w-fit"
                  >
                    View Lead <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
