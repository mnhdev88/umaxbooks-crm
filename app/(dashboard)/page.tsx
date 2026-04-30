'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanBoardClient } from '@/components/kanban/KanbanBoardClient'
import { useProfile } from '@/components/layout/DashboardShell'
import { Lead } from '@/types'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export default function PipelinePage() {
  const profile = useProfile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!profile) return
    supabase
      .from('leads')
      .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(id, full_name, email, role)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setLeads(data as Lead[])
        setLoading(false)
      })
  }, [profile])

  return (
    <>
      <div className="h-14 bg-[#0d1f3c]/80 border-b border-slate-800 flex items-center justify-between px-6 sticky top-0 z-30">
        <h1 className="text-base font-semibold text-slate-100">Pipeline</h1>
        {profile?.role !== 'developer' && (
          <Link href="/leads/new">
            <Button size="sm"><Plus size={14} /> New Lead</Button>
          </Link>
        )}
      </div>
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
          />
        )}
      </div>
    </>
  )
}
