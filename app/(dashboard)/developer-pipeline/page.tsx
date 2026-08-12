'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { useProfile } from '@/components/layout/DashboardShell'
import { Header } from '@/components/layout/Header'
import { Lead, PipelineStatus, Profile } from '@/types'
import { fetchActivityFlags, type ActivityMap } from '@/lib/activity-flags'

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

  useEffect(() => {
    if (!profile) return

    async function fetchLeads() {
      const buildQuery = (withFollowUps: boolean) => {
        const select = withFollowUps
          ? '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role), follow_ups(scheduled_at, status)'
          : '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role)'
        return supabase
          .from('leads')
          .select(select)
          .in('status', DEV_STAGES)
          .order('updated_at', { ascending: false })
      }

      let { data, error } = await buildQuery(true)
      if (error) {
        ;({ data, error } = await buildQuery(false))
      }
      if (data) {
        setLeads(data as unknown as Lead[])

        const contactedIds = (data as any[]).filter(l => l.status === 'Contacted').map(l => l.id)
        try {
          setActivityMap(await fetchActivityFlags(supabase, contactedIds))
        } catch (err) {
          console.error('Could not load email/call activity flags:', err)
        }
      }
      setLoading(false)
    }

    fetchLeads()

    const onFocus       = () => fetchLeads()
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
