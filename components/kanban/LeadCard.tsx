'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Lead, Profile } from '@/types'
import { Star, UserCheck, Phone, MailWarning, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LeadCardProps {
  lead: Lead
  overlay?: boolean
  userRole?: string
  agents?: Profile[]
  onReassign?: (leadId: string, agentId: string) => void
  callbackDate?: string | null
  emailSent?: boolean
  callLogged?: boolean
}

const FOLLOWUP_TERMINAL = new Set(['Live', 'Completed', 'Lost', 'Disqualified'])

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function getStaleDays(updatedAt: string): number {
  const updated = new Date(updatedAt)
  updated.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24))
}

type CallbackLevel = 'overdue' | 'today' | 'tomorrow' | 'future'

function formatCallbackDate(iso: string): { label: string; level: CallbackLevel } {
  const IST = 'Asia/Kolkata'
  const date = new Date(iso)

  const nowIST      = new Date()
  const tomorrowDate = new Date(nowIST)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)

  const todayIST    = nowIST.toLocaleDateString('en-CA', { timeZone: IST })
  const tomorrowIST = tomorrowDate.toLocaleDateString('en-CA', { timeZone: IST })
  const dateIST     = date.toLocaleDateString('en-CA', { timeZone: IST })

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: IST })

  if (dateIST < todayIST) {
    const daysLate = Math.round((new Date(todayIST).getTime() - new Date(dateIST).getTime()) / (1000 * 60 * 60 * 24))
    const lateLabel = daysLate === 1 ? '1 day overdue' : `${daysLate} days overdue`
    return { label: lateLabel, level: 'overdue' }
  }
  if (dateIST === todayIST)   return { label: `Today · ${timeStr} IST`,          level: 'today'    }
  if (dateIST === tomorrowIST) return { label: `Tomorrow · ${timeStr} IST`,      level: 'tomorrow' }
  return                              { label: `${dateStr} · ${timeStr} IST`,     level: 'future'   }
}

export function LeadCard({ lead, overlay, userRole, agents = [], onReassign, callbackDate, emailSent, callLogged }: LeadCardProps) {
  const [showReassign, setShowReassign] = useState(false)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const staleDays     = lead.updated_at ? getStaleDays(lead.updated_at) : 0
  const isAmber       = staleDays >= 2 && staleDays < 5
  const isRed         = staleDays >= 5
  const isStale       = isAmber || isRed
  const isAdmin       = userRole === 'admin'
  const callbackInfo   = callbackDate ? formatCallbackDate(callbackDate) : null
  const callbackLevel  = callbackInfo?.level ?? null
  const callbackUrgent = callbackLevel === 'overdue' || callbackLevel === 'today'
  const isFollowupDue  = !FOLLOWUP_TERMINAL.has(lead.status) && lead.updated_at && daysSince(lead.updated_at) >= 5 && !callbackUrgent

  function handleReassignSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const agentId = e.target.value
    if (!agentId) return
    onReassign?.(lead.id, agentId)
    setShowReassign(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => window.open(`/leads/${lead.id}`, '_blank')}
      className={cn(
        'bg-slate-800 border border-slate-700 rounded-xl p-2.5 group',
        'hover:border-orange-500/40 transition-all duration-150',
        'cursor-grab active:cursor-grabbing select-none',
        isRed   && 'border-red-600/50 hover:border-red-500/60',
        isAmber && !isRed && 'border-amber-600/50 hover:border-amber-500/60',
        isDragging && 'opacity-40',
        overlay && 'shadow-2xl border-orange-500/50 rotate-1'
      )}
    >
      {/* Company + NVL badge */}
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <p className="text-sm font-semibold text-slate-100 truncate">
          {lead.company_name}
        </p>
        {lead.lead_number && (
          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 border border-slate-600/40 whitespace-nowrap flex-shrink-0">
            NVL-{String(lead.lead_number).padStart(3, '0')}
          </span>
        )}
      </div>

      {/* Contact name + callback date + GMB rating */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400 truncate">{lead.name}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {callbackInfo && callbackLevel && (() => {
            const { label } = callbackInfo
            return (
              <span className={cn(
                'flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
                callbackLevel === 'overdue'   && 'bg-red-900/50 text-red-300 border-red-700/50',
                callbackLevel === 'today'     && 'bg-amber-900/50 text-amber-300 border-amber-700/50',
                callbackLevel === 'tomorrow'  && 'bg-yellow-900/30 text-yellow-400 border-yellow-700/40',
                callbackLevel === 'future'    && 'bg-slate-700/60 text-slate-400 border-slate-600/40',
              )}>
                <Phone size={8} />
                {label}
              </span>
            )
          })()}
          {lead.gmb_review_rating && (
            <span className="flex items-center gap-0.5 text-yellow-400">
              <Star size={10} fill="currentColor" />
              <span className="text-[10px] font-medium">{lead.gmb_review_rating}</span>
            </span>
          )}
        </div>
      </div>

      {/* Follow-up Due badge */}
      {isFollowupDue && (userRole === 'admin' || userRole === 'sales_agent') && (
        <div className="mt-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-300 bg-orange-500/15 border border-orange-500/30 px-1.5 py-0.5 rounded-full">
            <MailWarning size={9} />
            Follow-up Due
          </span>
        </div>
      )}

      {/* Email / Call activity indicators — Contacted column only */}
      {(emailSent || callLogged) && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {emailSent && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-sky-400 bg-sky-900/30 border border-sky-800/40 px-1.5 py-0.5 rounded-full">
              <Mail size={8} /> Emailed
            </span>
          )}
          {callLogged && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 bg-emerald-900/30 border border-emerald-800/40 px-1.5 py-0.5 rounded-full">
              <Phone size={8} /> Called
            </span>
          )}
        </div>
      )}

      {/* Assign / Reassign button — admin only */}
      {isAdmin && (isStale || lead.status === 'New') && (
        <div
          className="flex items-center justify-between gap-2 mt-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Current assignee */}
          {(lead as any).assigned_agent?.full_name ? (
            <span className="text-[10px] text-slate-500 truncate">
              {(lead as any).assigned_agent.full_name}
            </span>
          ) : (
            <span className="text-[10px] text-slate-600 italic">Unassigned</span>
          )}

          {!showReassign ? (
            <button
              onClick={() => setShowReassign(true)}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-orange-400 bg-slate-700/60 hover:bg-slate-700 px-1.5 py-0.5 rounded-full border border-slate-600/40 transition-colors whitespace-nowrap flex-shrink-0"
            >
              <UserCheck size={9} />
              {(lead as any).assigned_agent?.full_name ? 'Reassign' : 'Assign'}
            </button>
          ) : (
            <select
              autoFocus
              onChange={handleReassignSelect}
              onBlur={() => setShowReassign(false)}
              className="text-[10px] bg-slate-700 border border-slate-600 text-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-orange-500 w-full"
              defaultValue=""
            >
              <option value="" disabled>Select agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  )
}
