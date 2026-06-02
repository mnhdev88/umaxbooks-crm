'use client'

import { useState, useRef, useEffect } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core'
import { Lead, PipelineStatus, PIPELINE_STAGES, Profile } from '@/types'
import { ActivityMap } from '@/app/(dashboard)/page'
import { KanbanColumn } from './KanbanColumn'
import { LeadCard } from './LeadCard'
import { createClient } from '@/lib/supabase/client'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface KanbanBoardProps {
  initialLeads: Lead[]
  activityMap?: ActivityMap
  userRole: string
  userId: string
  stages?: PipelineStatus[]
}

export function KanbanBoard({ initialLeads, activityMap = {}, userRole, userId, stages }: KanbanBoardProps) {
  const [leads, setLeads]   = useState<Lead[]>(initialLeads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Profile[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const supabase = createClient()

  useEffect(() => {
    if (userRole !== 'admin') return
    supabase
      .from('profiles')
      .select('*')
      .in('role', ['agent', 'sales_agent'])
      .order('full_name')
      .then(({ data }) => { if (data) setAgents(data as Profile[]) })
  }, [userRole])

  function scrollBoard(direction: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: direction === 'left' ? -300 : 300, behavior: 'smooth' })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  const visibleStages = stages ?? PIPELINE_STAGES

  const FOLLOWUP_TERMINAL = new Set(['Live', 'Completed', 'Lost', 'Disqualified'])
  const FOLLOWUP_DAYS     = 5

  function isFollowupDue(lead: Lead): boolean {
    if (FOLLOWUP_TERMINAL.has(lead.status)) return false
    const age = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))
    return age >= FOLLOWUP_DAYS
  }

  function getNextCallback(lead: any): string | null {
    const pending = (lead.follow_ups || [])
      .filter((f: any) => f.status === 'pending' && f.scheduled_at)
      .map((f: any) => f.scheduled_at)
      .sort()
    return pending[0] ?? null
  }

  const columns = visibleStages.reduce<Record<PipelineStatus, Lead[]>>((acc, stage) => {
    const list = leads.filter((l) => l.status === stage)
    if (stage === 'Callback Booked') {
      list.sort((a, b) => {
        const da = getNextCallback(a)
        const db = getNextCallback(b)
        // Leads with no callback scheduled float to top (need scheduling — most recently updated first)
        if (!da && !db) return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        if (!da) return -1
        if (!db) return 1
        return new Date(da).getTime() - new Date(db).getTime()
      })
    } else {
      // Follow-up-due leads float to the top
      list.sort((a, b) => {
        const aDue = isFollowupDue(a) ? 0 : 1
        const bDue = isFollowupDue(b) ? 0 : 1
        return aDue - bDue
      })
    }
    acc[stage] = list
    return acc
  }, {} as Record<PipelineStatus, Lead[]>)

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  async function handleReassign(leadId: string, agentId: string) {
    const agent = agents.find((a) => a.id === agentId)
    const lead  = leads.find((l) => l.id === leadId)
    if (!agent || !lead) return

    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, assigned_agent_id: agentId } : l))

    await supabase.from('leads').update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() }).eq('id', leadId)

    await supabase.from('activity_logs').insert({
      lead_id: leadId, user_id: userId,
      action: 'Lead Reassigned',
      details: `Reassigned from ${(lead as any).assigned_agent?.full_name ?? 'unassigned'} to ${agent.full_name}`,
    })

    await supabase.from('notifications').insert({
      user_id: agentId,
      lead_id: leadId,
      title: 'Lead Assigned to You',
      message: `"${lead.company_name}" has been assigned to you.`,
      type: 'info',
    })
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
          {visibleStages.map((stage) => (
            <KanbanColumn
              key={stage}
              status={stage}
              leads={columns[stage] || []}
              userRole={userRole}
              agents={agents}
              onReassign={handleReassign}
              activityMap={stage === 'Contacted' ? activityMap : undefined}
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
