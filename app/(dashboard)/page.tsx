'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { useProfile } from '@/components/layout/DashboardShell'
import { Header } from '@/components/layout/Header'
import { Lead, PipelineStatus, PIPELINE_STAGES, Profile } from '@/types'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FollowUpsWidget } from '@/components/dashboard/FollowUpsWidget'
import { fetchActivityFlags, type ActivityMap } from '@/lib/activity-flags'
import { fetchAllPipelineLeads, PIPELINE_SELECT, PIPELINE_SELECT_NO_FOLLOWUPS, FOCUS_REFRESH_MIN_MS } from '@/lib/pipeline-leads'

// Re-exported so the kanban components and the developer pipeline keep their import path.
export type { ActivityMap }

export default function PipelinePage() {
  const profile = useProfile()
  const [leads, setLeads]           = useState<Lead[]>([])
  const [activityMap, setActivityMap] = useState<ActivityMap>({})
  const [loading, setLoading]       = useState(true)
  const supabase = createClient()

  // Last successful refresh + a counter so an older, slower response can't
  // overwrite a newer one (focus + crm:lead-updated can overlap).
  const lastFetchAt = useRef(0)
  const fetchSeq    = useRef(0)

  useEffect(() => {
    if (!profile) return
    const currentProfile = profile

    // Role scoping — applied to both the row count and every page query.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope = (q: any) => {
      if (currentProfile.role === 'developer') q = q.not('status', 'in', '("New","Callback Booked","Disqualified")')
      if (currentProfile.role === 'agent' || currentProfile.role === 'sales_agent') {
        q = q.eq('assigned_agent_id', currentProfile.id).neq('status', 'Disqualified')
      }
      return q
    }

    async function fetchLeads() {
      const seq = ++fetchSeq.current
      lastFetchAt.current = Date.now()

      let res = await fetchAllPipelineLeads<Lead>(supabase, PIPELINE_SELECT, scope)
      if (res.error) {
        // follow_ups table may not exist yet — fall back without the join
        console.warn('follow_ups join failed, retrying without:', res.error.message)
        res = await fetchAllPipelineLeads<Lead>(supabase, PIPELINE_SELECT_NO_FOLLOWUPS, scope)
      }
      if (seq !== fetchSeq.current) return // a newer refresh started; drop this one
      if (res.error && !res.data.length) {
        console.error('Could not load pipeline:', res.error.message)
        setLoading(false)
        return
      }

      // Show the board now; the email/call badges are secondary, so they load
      // afterwards instead of holding the whole board behind ~45 extra requests.
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

    // Refetch when the user comes back to the tab — but not on every alt-tab:
    // the full board is several MB, so skip it if we refreshed in the last minute.
    const onFocus    = () => { if (Date.now() - lastFetchAt.current > FOCUS_REFRESH_MIN_MS) fetchLeads() }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) fetchLeads() }
    const onLeadUpdated = () => fetchLeads()
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('crm:lead-updated', onLeadUpdated)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('crm:lead-updated', onLeadUpdated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase client is stable per mount
  }, [profile])

  return (
    <>
      <Header
        title="Pipeline"
        profile={profile as Profile}
        actions={profile?.role !== 'developer' ? (
          <Link href="/leads/new">
            <Button size="sm"><Plus size={14} /> New Lead</Button>
          </Link>
        ) : undefined}
      />
      {profile && (profile.role === 'sales_agent' || profile.role === 'sales_manager' || profile.role === 'admin') && (
        <FollowUpsWidget userId={profile.id} />
      )}
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
            stages={
              profile?.role === 'admin'
                ? undefined
                : profile?.role === 'developer'
                  ? PIPELINE_STAGES.filter(s => s !== 'New' && s !== 'Callback Booked' && s !== 'Disqualified')
                  : PIPELINE_STAGES.filter(s => s !== 'Disqualified')
            }
          />
        )}
      </div>
    </>
  )
}
