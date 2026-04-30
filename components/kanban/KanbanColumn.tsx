'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Lead, PipelineStatus } from '@/types'
import { LeadCard } from './LeadCard'
import { cn } from '@/lib/utils'
import { STATUS_COLORS } from '@/lib/utils'

interface KanbanColumnProps {
  status: PipelineStatus
  leads: Lead[]
}

const STATUS_COLUMN_COLORS: Record<string, string> = {
  New: 'border-slate-600',
  Contacted: 'border-blue-600',
  'Audit Ready': 'border-purple-600',
  'Demo Scheduled': 'border-yellow-600',
  'Demo Done': 'border-orange-600',
  'Closed Won': 'border-green-600',
  Revision: 'border-pink-600',
  Live: 'border-teal-600',
  Completed: 'border-emerald-600',
  Lost: 'border-red-700',
}

export function KanbanColumn({ status, leads }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div className={cn(
      'flex flex-col w-64 flex-shrink-0 rounded-xl bg-slate-900/60 border-t-2 transition-all duration-150',
      STATUS_COLUMN_COLORS[status],
      isOver && 'bg-slate-800/80 ring-1 ring-orange-500/30'
    )}>
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            STATUS_COLORS[status] || 'bg-slate-700 text-slate-200'
          )}>
            {status}
          </span>
        </div>
        <span className="text-xs text-slate-500 font-mono">{leads.length}</span>
      </div>

      {/* Cards */}
      <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex-1 px-2 pb-3 space-y-2 min-h-[120px]"
        >
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
          {leads.length === 0 && (
            <div className={cn(
              'h-20 rounded-lg border-2 border-dashed border-slate-700/50 flex items-center justify-center',
              isOver && 'border-orange-500/40 bg-orange-500/5'
            )}>
              <span className="text-[10px] text-slate-600">Drop here</span>
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}
