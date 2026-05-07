'use client'

import { useState, useCallback, useRef } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Lead, PipelineStatus, PIPELINE_STAGES } from '@/types'
import { KanbanColumn } from './KanbanColumn'
import { LeadCard } from './LeadCard'
import { createClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface KanbanBoardProps {
  initialLeads: Lead[]
  userRole: string
  userId: string
}

export function KanbanBoard({ initialLeads, userRole, userId }: KanbanBoardProps) {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  function scrollBoard(direction: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: direction === 'left' ? -300 : 300, behavior: 'smooth' })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const columns = PIPELINE_STAGES.reduce<Record<PipelineStatus, Lead[]>>((acc, stage) => {
    acc[stage] = leads.filter((l) => l.status === stage)
    return acc
  }, {} as Record<PipelineStatus, Lead[]>)

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const leadId = String(active.id)
    const overId = String(over.id)

    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return

    // overId can be a stage name (dropped on column) or another lead id
    const targetStatus = PIPELINE_STAGES.includes(overId as PipelineStatus)
      ? (overId as PipelineStatus)
      : leads.find((l) => l.id === overId)?.status

    if (!targetStatus || targetStatus === lead.status) return

    // Role guard: developer cannot move leads
    if (userRole === 'developer') return

    setLeads((prev) =>
      prev.map((l) => l.id === leadId ? { ...l, status: targetStatus } : l)
    )

    await supabase
      .from('leads')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('id', leadId)

    // Log activity
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Status Changed',
      details: `Status changed from "${lead.status}" to "${targetStatus}"`,
    })

    // Trigger notifications via API
    if (targetStatus === 'Demo Scheduled' || targetStatus === 'Revision') {
      await fetch('/api/notifications/status-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, newStatus: targetStatus }),
      })
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="relative">
        {/* Left scroll arrow */}
        <button
          onClick={() => scrollBoard('left')}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 shadow-lg transition-all"
          aria-label="Scroll left"
        >
          <ChevronLeft size={16} />
        </button>

        <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-4 px-10 pt-4 scroll-smooth">
          {PIPELINE_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              status={stage}
              leads={columns[stage] || []}
            />
          ))}
        </div>

        {/* Right scroll arrow */}
        <button
          onClick={() => scrollBoard('right')}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 shadow-lg transition-all"
          aria-label="Scroll right"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <DragOverlay>
        {activeLead && <LeadCard lead={activeLead} overlay />}
      </DragOverlay>
    </DndContext>
  )
}
