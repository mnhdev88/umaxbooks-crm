'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Lead } from '@/types'
import { StatusBadge } from '@/components/ui/Badge'
import { Building2, Phone, Star, GripVertical } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'

interface LeadCardProps {
  lead: Lead
  overlay?: boolean
}

export function LeadCard({ lead, overlay }: LeadCardProps) {
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-slate-800 border border-slate-700 rounded-xl p-3.5 group',
        'hover:border-orange-500/40 transition-all duration-150',
        isDragging && 'opacity-40',
        overlay && 'shadow-2xl border-orange-500/50 rotate-1'
      )}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 p-0.5 text-slate-600 hover:text-slate-400 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <Link href={`/leads/${lead.id}`} className="block">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-sm font-semibold text-slate-100 hover:text-orange-400 transition-colors truncate">
                {lead.company_name}
              </p>
            </div>

            <p className="text-xs text-slate-400 truncate mb-2">{lead.name}</p>

            <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
              {lead.phone && (
                <span className="flex items-center gap-1">
                  <Phone size={10} />
                  {lead.phone}
                </span>
              )}
              {lead.gmb_review_rating && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <Star size={10} />
                  {lead.gmb_review_rating}
                </span>
              )}
              {lead.city && (
                <span className="flex items-center gap-1">
                  <Building2 size={10} />
                  {lead.city}
                </span>
              )}
            </div>

            {lead.assigned_agent && (
              <div className="mt-2 flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-orange-500/30 flex items-center justify-center text-[9px] text-orange-400 font-bold">
                  {lead.assigned_agent.full_name.charAt(0)}
                </div>
                <span className="text-[10px] text-slate-500 truncate">{lead.assigned_agent.full_name}</span>
              </div>
            )}

            <p className="text-[10px] text-slate-600 mt-1.5">{formatDate(lead.created_at)}</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
