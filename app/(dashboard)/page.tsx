'use client'

import { useEffect, useState } from 'react'
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

// Re-exported so the kanban components and the developer pipeline keep their import path.
export type { ActivityMap }

export default function PipelinePage() {
  const profile = useProfile()
  const [leads, setLeads]           = useState<Lead[]>([])
  const [activityMap, setActivityMap] = useState<ActivityMap>({})
  const [loading, setLoading]       = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!profile) return
    const currentProfile = profile

    async function fetchLeads() {
      // PostgREST caps each response at 1000 rows, so page through in batches to
      // load every lead (keeps dashboard counts accurate past 1000).
      const BATCH = 1000
      const buildQuery = (withFollowUps: boolean, offset: number) => {
        const select = withFollowUps
          ? '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role), follow_ups(scheduled_at, status)'
          : '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role)'
        const q = supabase.from('leads').select(select).order('updated_at', { ascending: false }).range(offset, offset + BATCH - 1)
        if (currentProfile.role === 'developer') q.not('status', 'in', '("New","Callback Booked","Disqualified")')
        if (currentProfile.role === 'agent' || currentProfile.role === 'sales_agent') {
          q.eq('assigned_agent_id', currentProfile.id)
          q.neq('status', 'Disqualified')
        }
        return q
      }

      let withFollowUps = true
      const data: any[] = []
      let error: any = null
      for (let offset = 0; ; offset += BATCH) {
        let res = await buildQuery(withFollowUps, offset)
        if (res.error && withFollowUps) {
          // follow_ups table may not exist yet — fall back without the join
          console.warn('follow_ups join failed, retrying without:', res.error.message)
          withFollowUps = false
          res = await buildQuery(false, offset)
        }
        if (res.error) { error = res.error; break }
        const batch = res.data || []
        data.push(...batch)
        if (batch.length < BATCH) break
      }
      if (!error || data.length) {
        setLeads(data as unknown as Lead[])

        // Fetch email/call activity flags for Contacted leads only
        const contactedIds = (data as any[]).filter(l => l.status === 'Contacted').map(l => l.id)
        try {
          setActivityMap(await fetchActivityFlags(supabase, contactedIds))
        } catch (err) {
          // Badges are secondary to the board — log loudly but still render the leads.
          console.error('Could not load email/call activity flags:', err)
        }
      }
      setLoading(false)
    }

    fetchLeads()

    // Refetch when user returns to this tab (covers bfcache restore + tab switching)
    const onFocus    = () => fetchLeads()
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
