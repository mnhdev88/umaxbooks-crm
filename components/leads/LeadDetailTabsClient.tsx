'use client'

import dynamic from 'next/dynamic'
import { Lead, Profile } from '@/types'

const LeadDetailTabs = dynamic(
  () => import('./LeadDetailTabs').then(m => m.LeadDetailTabs),
  {
    ssr: false,
    loading: () => (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
        <svg className="animate-spin h-4 w-4 text-orange-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading...
      </div>
    ),
  }
)

interface Props {
  lead: Lead
  profile: Profile
  agents: Profile[]
  developers: Profile[]
  userId: string
}

export function LeadDetailTabsClient(props: Props) {
  return <LeadDetailTabs {...props} />
}
