'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ActivityLog } from '@/types'
import { timeAgo } from '@/lib/utils'
import { Activity, User } from 'lucide-react'

interface ActivityTabProps {
  leadId: string
}

const ACTION_COLORS: Record<string, string> = {
  'Lead Created': 'bg-green-500',
  'Lead Updated': 'bg-blue-500',
  'Status Changed': 'bg-orange-500',
  'Audit Uploaded': 'bg-purple-500',
  'Appointment Logged': 'bg-yellow-500',
  'Demo Uploaded': 'bg-teal-500',
  'Deal Created': 'bg-emerald-500',
  'Deal Updated': 'bg-blue-400',
  'Revision Info Submitted': 'bg-pink-500',
  'Live Site Created': 'bg-cyan-500',
  'Live Site Updated': 'bg-cyan-400',
}

export function ActivityTab({ leadId }: ActivityTabProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const supabase = createClient()

  useEffect(() => {
    fetchLogs()

    const channel = supabase
      .channel(`activity-${leadId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_logs',
        filter: `lead_id=eq.${leadId}`,
      }, (payload) => {
        setLogs((prev) => [payload.new as ActivityLog, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [leadId])

  async function fetchLogs() {
    const { data } = await supabase
      .from('activity_logs')
      .select('*, user:profiles(full_name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setLogs(data as ActivityLog[])
  }

  return (
    <div className="space-y-1">
      {logs.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No activity yet.</div>
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-700" />
          <div className="space-y-0">
            {logs.map((log, i) => (
              <div key={log.id} className="relative flex gap-4 pb-4">
                <div className={`relative z-10 flex-shrink-0 w-2.5 h-2.5 rounded-full mt-1.5 ml-3 ${ACTION_COLORS[log.action] || 'bg-slate-600'}`} />
                <div className="flex-1 min-w-0 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-sm font-semibold text-slate-200">{log.action}</span>
                      {log.user && (
                        <span className="text-xs text-slate-500 ml-2 flex items-center gap-1 inline-flex">
                          <User size={10} /> {log.user.full_name}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-600 flex-shrink-0">{timeAgo(log.created_at)}</span>
                  </div>
                  {log.details && (
                    <p className="text-xs text-slate-400 mt-1">{log.details}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
