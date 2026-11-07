'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { useProfile } from '@/components/layout/DashboardShell'
import { Header } from '@/components/layout/Header'
import { Lead, PipelineStatus, Profile } from '@/types'
import { fetchActivityFlags, type ActivityMap } from '@/lib/activity-flags'
import { fetchAllPipelineLeads, PIPELINE_SELECT, PIPELINE_SELECT_NO_FOLLOWUPS, FOCUS_REFRESH_MIN_MS } from '@/lib/pipeline-leads'

const DEV_STAGES: PipelineStatus[] = [
  'Contacted',
  'Audit Ready',
  'Demo Scheduled',
  'Demo Done',
  'Closed Won',
  'Revision',
  'Live',
  'Completed',
]

export default function DevPipelinePage() {
  const profile = useProfile()
  const [leads, setLeads]             = useState<Lead[]>([])
  const [activityMap, setActivityMap] = useState<ActivityMap>({})
  const [loading, setLoading]         = useState(true)
  const supabase = createClient()

  const lastFetchAt = useRef(0)
  const fetchSeq    = useRef(0)

  useEffect(() => {
    if (!profile) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope = (q: any) => q.in('status', DEV_STAGES)

    async function fetchLeads() {
      const seq = ++fetchSeq.current
      lastFetchAt.current = Date.now()

      // Slim columns + parallel pages (shared with the main pipeline). Also removes
      // the old silent 1000-row cap on this board.
      let res = await fetchAllPipelineLeads<Lead>(supabase, PIPELINE_SELECT, scope)
      if (res.error) res = await fetchAllPipelineLeads<Lead>(supabase, PIPELINE_SELECT_NO_FOLLOWUPS, scope)
      if (seq !== fetchSeq.current) return

      // Board first; email/call badges fill in afterwards.
      setLeads(res.data)
      setLoading(false)

      const contactedIds = res.data.filter(l => l.status === 'Contacted').map(l => l.id)
      try {
        const flags = await fetchActivityFlags(supabase, contactedIds)
        if (seq === fetchSeq.current) setActivityMap(flags)
      } catch (err) {
        console.error('Could not load email/call activity flags:', err)
      }
    }

    fetchLeads()

    // Skip focus refetches within a minute of the last refresh
    const onFocus       = () => { if (Date.now() - lastFetchAt.current > FOCUS_REFRESH_MIN_MS) fetchLeads() }
    const onPageShow    = (e: PageTransitionEvent) => { if (e.persisted) fetchLeads() }
    const onLeadUpdated = () => fetchLeads()
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('crm:lead-updated', onLeadUpdated)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('crm:lead-updated', onLeadUpdated)
    }
  }, [profile])

  return (
    <>
      <Header title="Dev Pipeline" profile={profile as Profile} />
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center gap-3 py-24 text-slate-500 text-sm">
            <svg className="animate-spin h-5 w-5 text-orange-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Loading pipeline...
          </div>
        ) : (
          <KanbanBoardClient
            initialLeads={leads}
            activityMap={activityMap}
            userRole={profile?.role || ''}
            userId={profile?.id || ''}
            stages={DEV_STAGES}
          />
        )}
      </div>
    </>
  )
}
