'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCorners,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { Lead, PipelineStatus, PIPELINE_STAGES, Profile } from '@/types'
import { ActivityMap } from '@/app/(dashboard)/page'
import { KanbanColumn } from './KanbanColumn'
import { LeadCard } from './LeadCard'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'

interface KanbanBoardProps {
  initialLeads: Lead[]
  activityMap?: ActivityMap
  userRole: string
  userId: string
  stages?: PipelineStatus[]
}

export function KanbanBoard({ initialLeads, activityMap = {}, userRole, userId, stages }: KanbanBoardProps) {
  const [leads, setLeads]         = useState<Lead[]>(initialLeads)
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [agents, setAgents]       = useState<Profile[]>([])
  const [search, setSearch]       = useState('')
  const [filterAgentId, setFilterAgentId] = useState('')
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

  // Scroll the board horizontally with the ← / → arrow keys. Skipped while typing
  // in a form control or while a card is being dragged (dnd-kit owns arrows then).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (activeId) return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      scrollBoard(e.key === 'ArrowLeft' ? 'left' : 'right')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const visibleStages = stages ?? PIPELINE_STAGES

  // Filter leads by search query and selected agent
  const displayLeads = useMemo(() => {
    let result = leads
    if (filterAgentId) {
      result = result.filter(l => (l as any).assigned_agent_id === filterAgentId)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.company_name?.toLowerCase().includes(q) ||
        l.name?.toLowerCase().includes(q) ||
        (l as any).phone?.toLowerCase().includes(q) ||
        (l as any).email?.toLowerCase().includes(q)
      )
    }
    return result
  }, [leads, search, filterAgentId])

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
    const list = displayLeads.filter((l) => l.status === stage)
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
    } else if (stage === 'New') {
      // Freshest leads on top — speed-to-lead matters most for new, uncontacted leads.
      // Stale ones are still flagged by the amber/red border + "Follow-up Due" badge on the card.
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
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

    const prevAgentId = (lead as any).assigned_agent_id ?? null
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, assigned_agent_id: agentId } : l))

    const { error: reassignError } = await supabase.from('leads').update({ assigned_agent_id: agentId, updated_at: new Date().toISOString() }).eq('id', leadId)
    if (reassignError) {
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, assigned_agent_id: prevAgentId } : l))
      toast.error('Failed to reassign lead. Change reverted.')
      return
    }

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

    const prevStatus = lead.status
    setLeads((prev) =>
      prev.map((l) => l.id === leadId ? { ...l, status: targetStatus } : l)
    )

    const { error: moveError } = await supabase
      .from('leads')
      .update({ status: targetStatus, updated_at: new Date().toISOString() })
      .eq('id', leadId)

    if (moveError) {
      setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: prevStatus } : l))
      toast.error('Failed to move lead. Card reverted.')
      return
    }

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

  const totalFiltered = displayLeads.length
  const hasFilter = !!search.trim() || !!filterAgentId

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* ── Search & filter toolbar ── */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-800 bg-[#0E0B24] shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads by name, company, phone…"
            aria-label="Search leads"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-8 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus:border-orange-500"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Agent filter — admin only */}
        {userRole === 'admin' && agents.length > 0 && (
          <select
            value={filterAgentId}
            onChange={e => setFilterAgentId(e.target.value)}
            aria-label="Filter by agent"
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus:border-orange-500 min-w-[160px]"
          >
            <option value="">All agents</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.full_name}</option>
            ))}
          </select>
        )}

        {/* Clear filters + count */}
        {hasFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{totalFiltered} lead{totalFiltered !== 1 ? 's' : ''}</span>
            <button
              onClick={() => { setSearch(''); setFilterAgentId('') }}
              className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="relative">
        {/* Scroll controls — a sticky overlay pinned to the viewport's vertical
            center, so the arrows stay reachable while scrolling down long columns
            (the page scrolls at the window level, not inside the board). The layer
            is click-through; only the buttons capture clicks. */}
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="sticky top-[50vh] -translate-y-1/2 flex items-center justify-between px-1">
            <button
              onClick={() => scrollBoard('left')}
              className="pointer-events-auto w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 shadow-lg transition-all"
              aria-label="Scroll left"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              onClick={() => scrollBoard('right')}
              className="pointer-events-auto w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 shadow-lg transition-all"
              aria-label="Scroll right"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex gap-3 overflow-x-auto pb-4 px-10 pt-4 scroll-smooth">
          {visibleStages.map((stage) => (
            <KanbanColumn
              key={stage}
              status={stage}
              leads={columns[stage] || []}
              userRole={userRole}
              userId={userId}
              agents={agents}
              onReassign={handleReassign}
              activityMap={stage === 'Contacted' ? activityMap : undefined}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeLead && <LeadCard lead={activeLead} overlay />}
      </DragOverlay>
    </DndContext>
  )
}

