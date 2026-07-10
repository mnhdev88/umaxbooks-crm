'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/components/layout/DashboardShell'
import { Header } from '@/components/layout/Header'
import { CalendarGrid, CalView, CalEvent } from '@/components/calendar/CalendarGrid'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay,
  addDays, addWeeks, addMonths, format,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Video, Phone } from 'lucide-react'

const DEMO_DURATION = 45
const CALLBACK_DURATION = 30

interface AgentOption { id: string; full_name: string | null }

// Parse a `date=YYYY-MM-DD` param into a local Date (noon avoids DST edge shifts)
function parseDateParam(v: string | null): Date {
  if (!v) return new Date()
  const [y, m, d] = v.split('-').map(Number)
  if (!y || !m || !d) return new Date()
  return new Date(y, m - 1, d, 12)
}

export default function CalendarPage() {
  const profile = useProfile()
  const supabase = createClient()
  const searchParams = useSearchParams()

  const [view, setView] = useState<CalView>(() => {
    const v = searchParams.get('view')
    return v === 'day' || v === 'week' || v === 'month' ? v : 'week'
  })
  const [viewDate, setViewDate] = useState<Date>(() => parseDateParam(searchParams.get('date')))
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)

  const [agents, setAgents] = useState<AgentOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState('all')

  const isPrivileged = profile?.role === 'sales_manager' || profile?.role === 'admin'

  // Visible range for the current view (drives the DB query window)
  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(viewDate), end: endOfDay(viewDate) }
    if (view === 'week') {
      return { start: startOfWeek(viewDate, { weekStartsOn: 0 }), end: endOfWeek(viewDate, { weekStartsOn: 0 }) }
    }
    return {
      start: startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 }),
    }
  }, [view, viewDate])

  // Which agents' leads this user may see (null = all, for admin)
  const visibleAgentIds = useMemo<string[] | null>(() => {
    if (!profile) return []
    if (profile.role === 'admin') return null
    if (profile.role === 'sales_manager') return [profile.id, ...agents.map(a => a.id)]
    return [profile.id] // sales_agent / agent
  }, [profile, agents])

  // Load the agent list for the manager/admin filter dropdown
  useEffect(() => {
    if (!profile || !isPrivileged) return
    const me = profile
    async function loadAgents() {
      const q = supabase.from('profiles').select('id, full_name')
      const { data } = me.role === 'admin'
        ? await q.in('role', ['agent', 'sales_agent', 'sales_manager']).order('full_name')
        : await q.eq('manager_id', me.id).order('full_name')
      setAgents((data ?? []) as AgentOption[])
    }
    loadAgents()
  }, [profile?.id, profile?.role])

  useEffect(() => {
    if (!profile) return
    fetchEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, range.start.getTime(), range.end.getTime(), selectedAgent, visibleAgentIds?.join(',')])

  async function fetchEvents() {
    setLoading(true)
    const startISO = range.start.toISOString()
    const endISO = range.end.toISOString()

    // Resolve the agent set to filter by (null = no restriction / admin "all")
    const effectiveIds: string[] | null =
      selectedAgent !== 'all' ? [selectedAgent] : visibleAgentIds

    const leadSelect =
      'id, company_name, name, slug, assigned_agent_id, assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)'

    let apptQ = supabase
      .from('appointments')
      .select(`id, lead_id, appointment_datetime, zoom_link, lead:leads!inner(${leadSelect})`)
      .not('appointment_datetime', 'is', null)
      .gte('appointment_datetime', startISO)
      .lte('appointment_datetime', endISO)
    if (effectiveIds) apptQ = apptQ.in('lead.assigned_agent_id', effectiveIds)

    let fuQ = supabase
      .from('follow_ups')
      .select(`id, lead_id, scheduled_at, notes, status, lead:leads!inner(${leadSelect})`)
      .gte('scheduled_at', startISO)
      .lte('scheduled_at', endISO)
    if (effectiveIds) fuQ = fuQ.in('lead.assigned_agent_id', effectiveIds)

    const [apptRes, fuRes] = await Promise.all([apptQ, fuQ])

    const demoEvents: CalEvent[] = (apptRes.data ?? []).map((a: any) => ({
      id: `demo-${a.id}`,
      type: 'demo',
      start: new Date(a.appointment_datetime),
      durationMin: DEMO_DURATION,
      leadId: a.lead?.id ?? a.lead_id ?? null,
      title: a.lead?.company_name || 'Demo',
      subtitle: a.lead?.name || undefined,
      agentName: a.lead?.assigned_agent?.full_name || undefined,
      zoomLink: a.zoom_link || null,
    }))

    const callbackEvents: CalEvent[] = (fuRes.data ?? []).map((f: any) => ({
      id: `cb-${f.id}`,
      type: 'callback',
      start: new Date(f.scheduled_at),
      durationMin: CALLBACK_DURATION,
      leadId: f.lead?.id ?? f.lead_id ?? null,
      title: f.lead?.company_name || 'Callback',
      subtitle: f.lead?.name || undefined,
      agentName: f.lead?.assigned_agent?.full_name || undefined,
      status: f.status,
    }))

    setEvents([...demoEvents, ...callbackEvents])
    setLoading(false)
  }

  function shift(dir: -1 | 1) {
    setViewDate(d =>
      view === 'day' ? addDays(d, dir) :
      view === 'week' ? addWeeks(d, dir) :
      addMonths(d, dir)
    )
  }

  const rangeLabel = useMemo(() => {
    if (view === 'day') return format(viewDate, 'EEEE, MMMM d, yyyy')
    if (view === 'month') return format(viewDate, 'MMMM yyyy')
    const s = startOfWeek(viewDate, { weekStartsOn: 0 })
    const e = endOfWeek(viewDate, { weekStartsOn: 0 })
    return format(s, 'MMM d') + ' – ' +
      (format(s, 'MMM') === format(e, 'MMM') ? format(e, 'd, yyyy') : format(e, 'MMM d, yyyy'))
  }, [view, viewDate])

  if (!profile) return null

  return (
    <>
      <Header title="Calendar" profile={profile} />

      <div className="p-4 md:p-6 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              aria-label="Previous"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => shift(1)}
              aria-label="Next"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setViewDate(new Date())}
              className="ml-1 px-3 h-8 rounded-lg border border-slate-700 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Today
            </button>
          </div>

          <h2 className="text-lg font-semibold text-slate-100">{rangeLabel}</h2>

          <div className="flex items-center gap-2 ml-auto">
            {/* Agent filter (managers / admin) */}
            {isPrivileged && (
              <div className="w-44">
                <Select
                  aria-label="Filter by agent"
                  value={selectedAgent}
                  onChange={e => setSelectedAgent(e.target.value)}
                  options={[
                    { value: 'all', label: profile.role === 'admin' ? 'All agents' : 'My team' },
                    ...(profile.role === 'sales_manager'
                      ? [{ value: profile.id, label: `${profile.full_name ?? 'Me'} (me)` }]
                      : []),
                    ...agents.map(a => ({ value: a.id, label: a.full_name ?? 'Unnamed' })),
                  ]}
                />
              </div>
            )}

            {/* View switch */}
            <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
              {(['day', 'week', 'month'] as CalView[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'px-3 h-8 text-sm capitalize transition-colors',
                    view === v
                      ? 'bg-orange-500/15 text-orange-300 font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-500/20 border border-blue-500/60">
              <Video size={9} className="text-blue-300" />
            </span>
            Demo scheduled
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-orange-500/20 border border-orange-500/60">
              <Phone size={9} className="text-orange-300" />
            </span>
            Callback booked
          </span>
          {loading && <span className="text-slate-500">Loading…</span>}
          {!loading && <span className="text-slate-500 ml-auto">{events.length} event{events.length === 1 ? '' : 's'}</span>}
        </div>

        <CalendarGrid view={view} viewDate={viewDate} events={events} />
      </div>
    </>
  )
}
