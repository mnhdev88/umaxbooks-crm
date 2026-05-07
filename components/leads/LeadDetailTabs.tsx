'use client'

import { useState } from 'react'
import { Lead, Profile } from '@/types'
import { AuditTab } from './tabs/AuditTab'
import { AppointmentTab } from './tabs/AppointmentTab'
import { DemoTab } from './tabs/DemoTab'
import { DealTab } from './tabs/DealTab'
import { RevisionTab } from './tabs/RevisionTab'
import { LiveTab } from './tabs/LiveTab'
import { ActivityTab } from './tabs/ActivityTab'
import { SendContentTab } from './tabs/SendContentTab'
import { BeforeAfterTab } from './tabs/BeforeAfterTab'
import { cn } from '@/lib/utils'
import { LeadForm } from './LeadForm'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Edit2 } from 'lucide-react'

const ALL_TABS = [
  { id: 'activity',     label: 'Activity',       roles: ['admin', 'agent', 'sales_agent', 'developer'] },
  { id: 'audits',       label: 'Audits',          roles: ['admin', 'agent', 'sales_agent', 'developer'] },
  { id: 'appointments', label: 'Calls & Appts',   roles: ['admin', 'sales_agent'] },
  { id: 'demo',         label: 'Demo',            roles: ['admin', 'sales_agent'] },
  { id: 'before-after', label: 'Before / After',  roles: ['admin', 'sales_agent'] },
  { id: 'deal',         label: 'Deal',            roles: ['admin', 'sales_agent'] },
  { id: 'revisions',    label: 'Revisions',       roles: ['admin', 'sales_agent'] },
  { id: 'live',         label: 'Live',            roles: ['admin', 'sales_agent'] },
  { id: 'send-content', label: 'Send Content',    roles: ['admin', 'sales_agent'] },
]

interface LeadDetailTabsProps {
  lead: Lead
  profile: Profile
  agents: Profile[]
  developers: Profile[]
  userId: string
}

export function LeadDetailTabs({ lead, profile, agents, developers, userId }: LeadDetailTabsProps) {
  const TABS = ALL_TABS.filter(t => t.roles.includes(profile.role))
  const [activeTab, setActiveTab] = useState(TABS[0]?.id || 'activity')
  const [showEditModal, setShowEditModal] = useState(false)

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {/* Tab nav */}
      <div className="border-b border-slate-800 px-4">
        {/* Mobile: dropdown */}
        <div className="flex items-center gap-2 py-2 md:hidden">
          <select
            value={activeTab}
            onChange={e => setActiveTab(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
          >
            {TABS.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
          {profile.role !== 'developer' && (
            <Button size="sm" variant="ghost" onClick={() => setShowEditModal(true)} className="flex-shrink-0">
              <Edit2 size={13} /> Edit
            </Button>
          )}
        </div>

        {/* Desktop: tab buttons */}
        <div className="hidden md:flex items-center justify-between overflow-x-auto">
          <div className="flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {profile.role !== 'developer' && (
            <Button size="sm" variant="ghost" onClick={() => setShowEditModal(true)} className="ml-2 flex-shrink-0">
              <Edit2 size={13} /> Edit Lead
            </Button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-5">
        {activeTab === 'activity' && <ActivityTab leadId={lead.id} />}
        {activeTab === 'audits' && (
          <AuditTab
            leadId={lead.id}
            leadSlug={lead.slug}
            userId={userId}
            userRole={profile.role}
            websiteUrl={lead.website_url}
            businessName={lead.company_name}
            city={lead.city}
            leadEmail={lead.email ?? ''}
            leadName={lead.name ?? ''}
          />
        )}
        {activeTab === 'appointments' && (
          <AppointmentTab leadId={lead.id} userId={userId} userRole={profile.role} zipCode={lead.zip_code} />
        )}
        {activeTab === 'demo' && (
          <DemoTab leadId={lead.id} userId={userId} userRole={profile.role} developers={developers} />
        )}
        {activeTab === 'before-after' && (
          <BeforeAfterTab leadId={lead.id} lead={lead} userId={userId} />
        )}
        {activeTab === 'deal' && (
          <DealTab leadId={lead.id} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'revisions' && (
          <RevisionTab leadId={lead.id} leadSlug={lead.slug} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'live' && (
          <LiveTab leadId={lead.id} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'send-content' && (
          <SendContentTab lead={lead} userId={userId} userRole={profile.role} />
        )}
      </div>

      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Edit Lead" size="lg">
        <LeadForm
          lead={lead}
          agents={agents}
          userId={userId}
          onSuccess={() => setShowEditModal(false)}
        />
      </Modal>
    </div>
  )
}
