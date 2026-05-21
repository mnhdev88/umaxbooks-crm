'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { useProfile } from '@/components/layout/DashboardShell'
import { Lead, PipelineStatus, PIPELINE_STAGES } from '@/types'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FollowUpsWidget } from '@/components/dashboard/FollowUpsWidget'

export default function PipelinePage() {
  const profile = useProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!profile) return
    const currentProfile = profile

    async function fetchLeads() {
      const buildQuery = (withFollowUps: boolean) => {
        const select = withFollowUps
          ? '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role), follow_ups(scheduled_at, status)'
          : '*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role)'
        const q = supabase.from('leads').select(select).order('updated_at', { ascending: false })
        if (currentProfile.role === 'developer') q.not('status', 'in', '("New","Callback Booked","Disqualified")')
        if (currentProfile.role === 'agent' || currentProfile.role === 'sales_agent') {
          q.eq('assigned_agent_id', currentProfile.id)
          q.neq('status', 'Disqualified')
        }
        return q
      }

      let { data, error } = await buildQuery(true)
      if (error) {
        // follow_ups table may not exist yet — fall back
        console.warn('follow_ups join failed, retrying without:', error.message)
        ;({ data, error } = await buildQuery(false))
      }
      if (data) setLeads(data as unknown as Lead[])
      setLoading(false)
    }

    fetchLeads()

    // Refetch when user returns to this tab (covers bfcache restore + tab switching)
    const onFocus = () => fetchLeads()
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) fetchLeads() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [profile])

  return (
    <>
      <div className="h-14 bg-[#160E32]/80 border-b border-slate-800 flex items-center justify-between px-6 sticky top-0 z-30">
        <h1 className="text-base font-semibold text-slate-100">Pipeline</h1>
        {profile?.role !== 'developer' && (
          <Link href="/leads/new">
            <Button size="sm"><Plus size={14} /> New Lead</Button>
          </Link>
        )}
      </div>
      {profile && (profile.role === 'sales_agent' || profile.role === 'admin') && (
        <FollowUpsWidget userId={profile.id} />
      )}
      <div className="flex-1 overflow-hidden">
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
