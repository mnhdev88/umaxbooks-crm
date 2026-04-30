'use client'

import dynamic from 'next/dynamic'
import { Lead } from '@/types'

const KanbanBoard = dynamic(
  () => import('./KanbanBoard').then(m => m.KanbanBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center flex-1 text-slate-500 text-sm gap-3 py-20">
        <svg className="animate-spin h-5 w-5 text-orange-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading pipeline...
      </div>
    ),
  }
)

interface Props {
  initialLeads: Lead[]
  userRole: string
  userId: string
}

export function KanbanBoardClient(props: Props) {
  return <KanbanBoard {...props} />
}
