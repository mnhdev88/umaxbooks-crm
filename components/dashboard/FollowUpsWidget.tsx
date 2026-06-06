'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Bell, Phone, Clock, CheckCircle2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface FollowUp {
  id: string
  lead_id: string
  scheduled_at: string
  notes: string | null
  status: string
  notified_at: string | null
  lead: {
    id: string
    company_name: string
    name: string
    slug: string
  } | null
}

interface FollowUpsWidgetProps {
  userId: string
}

export function FollowUpsWidget({ userId }: FollowUpsWidgetProps) {
  const supabase = createClient()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [completing, setCompleting] = useState<string | null>(null)

  useEffect(() => { fetchAndNotify() }, [userId])

  async function fetchAndNotify() {
    const now = new Date()
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const { data } = await supabase
      .from('follow_ups')
      .select('*, lead:leads(id, company_name, name, slug)')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .lte('scheduled_at', sevenDaysLater.toISOString())
      .order('scheduled_at', { ascending: true })

    if (!data) return
    setFollowUps(data as FollowUp[])

    // Fire in-app notification for any overdue follow-ups that haven't been notified yet
    const overdue = data.filter(f =>
      new Date(f.scheduled_at) <= now && !f.notified_at
    )

    if (overdue.length > 0) {
      await supabase.from('notifications').insert(
        overdue.map(f => ({
          user_id: userId,
          lead_id: f.lead_id,
          title: `Follow-up Due — ${f.lead?.company_name || 'Lead'}`,
          message: f.notes
            ? `Callback reminder: ${f.notes.slice(0, 80)}`
            : `You have a pending callback for ${f.lead?.company_name || 'this lead'}.`,
          type: 'info',
        }))
      )

      // Mark notified so it doesn't fire again
      await supabase
        .from('follow_ups')
        .update({ notified_at: now.toISOString() })
        .in('id', overdue.map(f => f.id))

      // Update local state
      setFollowUps(prev =>
        prev.map(f =>
          overdue.find(o => o.id === f.id)
            ? { ...f, notified_at: now.toISOString() }
            : f
        )
      )
    }
  }

  async function markComplete(id: string, leadId: string) {
    setCompleting(id)
    await supabase
      .from('follow_ups')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
    setFollowUps(prev => prev.filter(f => f.id !== id))
    setCompleting(null)
  }

  if (followUps.length === 0) return null

  const now = new Date()

  return (
    <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell size={14} className="text-orange-400" />
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Upcoming Callbacks
        </p>
        <span className="ml-1 text-xs font-bold px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30">
          {followUps.length}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1">
        {followUps.map(f => {
          const scheduledDate = new Date(f.scheduled_at)
          const isOverdue = scheduledDate < now
          const isToday = scheduledDate.toDateString() === now.toDateString()
          const isTomorrow = scheduledDate.toDateString() === new Date(now.getTime() + 86400000).toDateString()

          const timeLabel = isOverdue
            ? 'Overdue'
            : isToday
              ? `Today ${scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : isTomorrow
                ? `Tomorrow ${scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : scheduledDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
                  ' ' + scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

          return (
            <div
              key={f.id}
              className={cn(
                'flex-shrink-0 w-64 rounded-xl border p-3.5 space-y-2',
                isOverdue
                  ? 'bg-red-900/20 border-red-700/50'
                  : isToday
                    ? 'bg-orange-900/20 border-orange-700/50'
                    : 'bg-slate-800/60 border-slate-700'
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100 truncate">
                    {f.lead?.company_name || 'Unknown Lead'}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{f.lead?.name}</p>
                </div>
                {f.lead?.id && (
                  <Link
                    href={`/leads/${f.lead.id}`}
                    aria-label={`Open ${f.lead?.company_name || 'lead'}`}
                    className="flex-shrink-0 inline-flex items-center justify-center min-w-9 min-h-9 -mr-1.5 text-slate-500 hover:text-orange-400 transition-colors"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                  </Link>
                )}
              </div>

              {/* Time */}
              <div className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                isOverdue ? 'text-red-400' : isToday ? 'text-orange-400' : 'text-slate-400'
              )}>
                <Clock size={11} />
                {timeLabel}
              </div>

              {/* Notes */}
              {f.notes && (
                <p className="text-xs text-slate-400 line-clamp-2">{f.notes}</p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-0.5">
                {f.lead?.id && (
                  <Link
                    href={`/leads/${f.lead.id}`}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 border border-slate-700 hover:border-orange-500/50 rounded-lg px-3 py-2 transition-colors"
                  >
                    <Phone size={10} aria-hidden="true" /> Call Now
                  </Link>
                )}
                <button
                  onClick={() => markComplete(f.id, f.lead_id)}
                  disabled={completing === f.id}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-green-400 border border-slate-700 hover:border-green-600/50 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 size={10} />
                  {completing === f.id ? '…' : 'Done'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
