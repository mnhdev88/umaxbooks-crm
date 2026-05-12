'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Lead, Profile } from '@/types'
import { Star, UserCheck, Phone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface LeadCardProps {
  lead: Lead
  overlay?: boolean
  userRole?: string
  agents?: Profile[]
  onReassign?: (leadId: string, agentId: string) => void
  callbackDate?: string | null
}

function getStaleDays(updatedAt: string): number {
  const updated = new Date(updatedAt)
  updated.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24))
}

function formatCallbackDate(iso: string): { label: string; urgent: boolean; today: boolean } {
  const date = new Date(iso)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(todayStart.getTime() + 86400000)
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (dateStart.getTime() < todayStart.getTime()) {
    return { label: 'Overdue', urgent: true, today: false }
  }
  if (dateStart.getTime() === todayStart.getTime()) {
    return { label: 'Call Today', urgent: true, today: true }
  }
  if (dateStart.getTime() === tomorrowStart.getTime()) {
    return { label: 'Tomorrow', urgent: false, today: false }
  }
  return {
    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    urgent: false,
    today: false,
  }
}

export function LeadCard({ lead, overlay, userRole, agents = [], onReassign, callbackDate }: LeadCardProps) {
  const router = useRouter()
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

  const staleDays = lead.updated_at ? getStaleDays(lead.updated_at) : 0
  const isAmber   = staleDays >= 2 && staleDays < 5
  const isRed     = staleDays >= 5
  const isStale   = isAmber || isRed
  const isAdmin   = userRole === 'admin'

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
      onClick={() => router.push(`/leads/${lead.id}`)}
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
          {callbackDate && (() => {
            const { label, urgent, today } = formatCallbackDate(callbackDate)
            return (
              <span className={cn(
                'flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
                urgent
                  ? 'bg-red-900/50 text-red-300 border-red-700/50'
                  : today
                    ? 'bg-cyan-900/50 text-cyan-300 border-cyan-700/50'
                    : 'bg-slate-700/60 text-slate-400 border-slate-600/40'
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

      {/* Reassign button — admin only, stale leads */}
      {isStale && isAdmin && (
        <div
          className="flex justify-end mt-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!showReassign ? (
            <button
              onClick={() => setShowReassign(true)}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-orange-400 bg-slate-700/60 hover:bg-slate-700 px-1.5 py-0.5 rounded-full border border-slate-600/40 transition-colors"
            >
              <UserCheck size={9} /> Reassign
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
