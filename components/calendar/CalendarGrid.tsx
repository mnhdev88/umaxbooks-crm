'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, format, addDays,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { Video, Phone, CheckCircle2 } from 'lucide-react'

export type CalView = 'day' | 'week' | 'month'

export interface CalEvent {
  id: string
  type: 'demo' | 'callback'
  start: Date
  durationMin: number
  leadId: string | null
  title: string        // company name
  subtitle?: string    // contact name
  agentName?: string
  status?: string      // follow_ups status (pending/completed)
  zoomLink?: string | null
}

const HOUR_HEIGHT = 48                 // px per hour in day/week time grid
const DAY_MINUTES = 24 * 60

// ---- Overlap layout: assign each event a column within a cluster of overlapping events
function layoutColumns(events: CalEvent[]) {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime())
  const placed: { ev: CalEvent; col: number; cols: number }[] = []
  let cluster: { ev: CalEvent; end: number; col: number }[] = []
  let clusterMaxEnd = -Infinity

  const flush = () => {
    if (!cluster.length) return
    const cols = Math.max(...cluster.map(c => c.col)) + 1
    for (const c of cluster) placed.push({ ev: c.ev, col: c.col, cols })
    cluster = []
    clusterMaxEnd = -Infinity
  }

  for (const ev of sorted) {
    const startMin = ev.start.getHours() * 60 + ev.start.getMinutes()
    const endMin = startMin + ev.durationMin
    if (cluster.length && startMin >= clusterMaxEnd) flush()
    // find first free column
    const used = new Set(cluster.filter(c => c.end > startMin).map(c => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ev, end: endMin, col })
    clusterMaxEnd = Math.max(clusterMaxEnd, endMin)
  }
  flush()
  return placed
}

function eventClasses(ev: CalEvent) {
  const done = ev.type === 'callback' && ev.status === 'completed'
  if (done) return 'bg-slate-700/50 border-slate-600 text-slate-400'
  return ev.type === 'demo'
    ? 'bg-blue-500/20 border-blue-500/60 text-blue-100 hover:bg-blue-500/30'
    : 'bg-orange-500/20 border-orange-500/60 text-orange-100 hover:bg-orange-500/30'
}

interface CalendarGridProps {
  view: CalView
  viewDate: Date
  events: CalEvent[]
}

export function CalendarGrid({ view, viewDate, events }: CalendarGridProps) {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the time grid to ~7 AM on mount / view change
  useEffect(() => {
    if (view !== 'month' && scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT
    }
  }, [view, viewDate])

  const openEvent = (ev: CalEvent) => {
    if (ev.leadId) router.push(`/leads/${ev.leadId}`)
  }

  if (view === 'month') {
    return <MonthGrid viewDate={viewDate} events={events} onOpen={openEvent} />
  }

  const days = view === 'day'
    ? [viewDate]
    : eachDayOfInterval({
        start: startOfWeek(viewDate, { weekStartsOn: 0 }),
        end: endOfWeek(viewDate, { weekStartsOn: 0 }),
      })

  const hours = Array.from({ length: 24 }, (_, h) => h)

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      {/* Day header row */}
      <div className="flex border-b border-slate-800 bg-slate-900/60">
        <div className="w-14 shrink-0 border-r border-slate-800" />
        {days.map(day => (
          <div
            key={day.toISOString()}
            className={cn(
              'flex-1 text-center py-2 border-r border-slate-800 last:border-r-0',
              isToday(day) && 'bg-orange-500/10'
            )}
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{format(day, 'EEE')}</div>
            <div className={cn(
              'text-sm font-semibold mt-0.5',
              isToday(day) ? 'text-orange-400' : 'text-slate-200'
            )}>
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="overflow-y-auto scrollbar-hide" style={{ maxHeight: 'calc(100vh - 240px)' }}>
        <div className="flex">
          {/* Time gutter */}
          <div className="w-14 shrink-0 border-r border-slate-800">
            {hours.map(h => (
              <div key={h} className="relative border-b border-slate-800/60" style={{ height: HOUR_HEIGHT }}>
                <span className="absolute -top-2 right-1.5 text-[10px] text-slate-500">
                  {h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayEvents = events.filter(e => isSameDay(e.start, day))
            const laid = layoutColumns(dayEvents)
            return (
              <div
                key={day.toISOString()}
                className="relative flex-1 border-r border-slate-800 last:border-r-0"
                style={{ height: DAY_MINUTES / 60 * HOUR_HEIGHT }}
              >
                {/* Hour lines */}
                {hours.map(h => (
                  <div key={h} className="border-b border-slate-800/60" style={{ height: HOUR_HEIGHT }} />
                ))}

                {/* Now indicator */}
                {isToday(day) && <NowLine />}

                {/* Events */}
                {laid.map(({ ev, col, cols }) => {
                  const startMin = ev.start.getHours() * 60 + ev.start.getMinutes()
                  const top = startMin / 60 * HOUR_HEIGHT
                  const height = Math.max((ev.durationMin / 60) * HOUR_HEIGHT - 2, 20)
                  const widthPct = 100 / cols
                  const Icon = ev.type === 'demo' ? Video : Phone
                  const done = ev.type === 'callback' && ev.status === 'completed'
                  return (
                    <button
                      key={ev.id}
                      onClick={() => openEvent(ev)}
                      title={`${ev.title} — ${format(ev.start, 'h:mm a')}`}
                      className={cn(
                        'absolute rounded-md border px-1.5 py-1 text-left overflow-hidden transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60',
                        eventClasses(ev)
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                        <Icon size={10} className="shrink-0" />
                        <span className="truncate">{ev.title}</span>
                        {done && <CheckCircle2 size={10} className="shrink-0 text-green-400" />}
                      </div>
                      {height > 30 && (
                        <div className="text-[10px] opacity-80 truncate leading-tight">
                          {format(ev.start, 'h:mm a')}{ev.subtitle ? ` · ${ev.subtitle}` : ''}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NowLine() {
  const now = new Date()
  const top = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT
  return (
    <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top }}>
      <div className="h-px bg-red-500" />
      <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
    </div>
  )
}

// ---- Month view
function MonthGrid({ viewDate, events, onOpen }: { viewDate: Date; events: CalEvent[]; onOpen: (e: CalEvent) => void }) {
  const router = useRouter()
  const gridDays = useMemo(() => eachDayOfInterval({
    start: startOfWeek(startOfMonth(viewDate), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(viewDate), { weekStartsOn: 0 }),
  }), [viewDate])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const e of events) {
      const key = format(e.start, 'yyyy-MM-dd')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    for (const list of map.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime())
    return map
  }, [events])

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-800 bg-slate-900/60">
        {weekdays.map(d => (
          <div key={d} className="text-center py-2 text-[11px] uppercase tracking-wide text-slate-500">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {gridDays.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          const dayEvents = eventsByDay.get(key) ?? []
          const inMonth = isSameMonth(day, viewDate)
          return (
            <div
              key={key}
              className={cn(
                'min-h-[104px] border-b border-r border-slate-800 p-1.5 last-of-type:border-r-0',
                !inMonth && 'bg-slate-900/60'
              )}
            >
              <div className="flex justify-end">
                <span className={cn(
                  'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs',
                  isToday(day) ? 'bg-orange-500 text-white font-bold'
                    : inMonth ? 'text-slate-300' : 'text-slate-600'
                )}>
                  {format(day, 'd')}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map(ev => {
                  const Icon = ev.type === 'demo' ? Video : Phone
                  return (
                    <button
                      key={ev.id}
                      onClick={() => onOpen(ev)}
                      title={`${ev.title} — ${format(ev.start, 'h:mm a')}`}
                      className={cn(
                        'w-full flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium border text-left overflow-hidden',
                        eventClasses(ev)
                      )}
                    >
                      <Icon size={9} className="shrink-0" />
                      <span className="shrink-0 opacity-80">{format(ev.start, 'h:mm')}</span>
                      <span className="truncate">{ev.title}</span>
                    </button>
                  )
                })}
                {dayEvents.length > 3 && (
                  <button
                    onClick={() => router.push(`/calendar?view=day&date=${key}`)}
                    className="w-full text-left text-[10px] text-slate-500 hover:text-orange-400 px-1"
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
