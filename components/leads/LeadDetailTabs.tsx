'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Lead, Profile } from '@/types'
import { AuditTab } from './tabs/AuditTab'
import { AppointmentTab } from './tabs/AppointmentTab'
import { DemoTab } from './tabs/DemoTab'
import { DealTab } from './tabs/DealTab'
import { RevisionTab } from './tabs/RevisionTab'
import { LiveTab } from './tabs/LiveTab'
import { ActivityTab } from './tabs/ActivityTab'
import { NotesTab } from './tabs/NotesTab'
import { SendContentTab } from './tabs/SendContentTab'
import { BeforeAfterTab } from './tabs/BeforeAfterTab'
import { ContractTab } from '@/components/contracts/ContractTab'
import { WebsiteDetailsTab } from './tabs/WebsiteDetailsTab'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const ALL_TABS = [
  { id: 'audits',          label: 'Audits',          roles: ['admin', 'agent', 'sales_agent', 'developer'] },
  { id: 'notes',           label: 'Notes',           roles: ['admin', 'agent', 'sales_agent', 'developer'] },
  { id: 'demo',            label: 'Demo',            roles: ['admin', 'sales_agent', 'developer'] },
  { id: 'appointments',    label: 'Calls & Appts',   roles: ['admin', 'sales_agent'] },
  { id: 'deal',            label: 'Deal',            roles: ['admin', 'sales_agent'] },
  { id: 'contract',        label: 'Contract',        roles: ['admin'] },
  { id: 'revisions',       label: 'Revisions',       roles: ['admin', 'sales_agent'] },
  { id: 'live',            label: 'Live',            roles: ['admin', 'sales_agent'] },
  { id: 'before-after',    label: 'Before / After',  roles: ['admin', 'sales_agent'] },
  { id: 'website-details', label: 'Client Portal',   roles: ['admin'] },
  { id: 'send-content',    label: 'Send Content',    roles: ['admin', 'sales_agent', 'developer'] },
  { id: 'activity',        label: 'Activity',        roles: ['admin', 'agent', 'sales_agent', 'developer'] },
]

interface LeadDetailTabsProps {
  lead: Lead
  profile: Profile
  agents: Profile[]
  developers: Profile[]
  userId: string
  initialTab?: string
}

export function LeadDetailTabs({ lead, profile, agents, developers, userId, initialTab }: LeadDetailTabsProps) {
  const TABS = ALL_TABS.filter(t => t.roles.includes(profile.role))
  const defaultTab = (initialTab && TABS.find(t => t.id === initialTab))
    ? initialTab
    : TABS[0]?.id || 'activity'
  const [activeTab, setActiveTab] = useState(defaultTab)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft,  setCanScrollLeft]  = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    el?.addEventListener('scroll', checkScroll, { passive: true })
    window.addEventListener('resize', checkScroll)
    return () => {
      el?.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [checkScroll])

  function scrollTabs(dir: 'left' | 'right') {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -160 : 160, behavior: 'smooth' })
  }

  function handleTabClick(id: string) {
    setActiveTab(id)
    // Scroll the active tab into view
    const el = scrollRef.current
    if (!el) return
    const btn = el.querySelector<HTMLElement>(`[data-tab="${id}"]`)
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      {/* Tab nav */}
      <div className="border-b border-slate-800">
        {/* Mobile: dropdown */}
        <div className="flex items-center gap-2 px-4 py-2 md:hidden">
          <select
            value={activeTab}
            onChange={e => setActiveTab(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
          >
            {TABS.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
        </div>

        {/* Desktop: scrollable tab bar */}
        <div className="hidden md:flex items-stretch relative">
          {/* Left scroll button */}
          {canScrollLeft && (
            <button
              onClick={() => scrollTabs('left')}
              className="shrink-0 flex items-center px-2 text-slate-500 hover:text-slate-200
                         bg-slate-900 border-r border-slate-800 transition-colors z-10"
            >
              <ChevronLeft size={14} />
            </button>
          )}

          {/* Tabs */}
          <div
            ref={scrollRef}
            className="flex overflow-x-auto scrollbar-hide flex-1"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-tab={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={cn(
                  'px-3 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap shrink-0',
                  activeTab === tab.id
                    ? 'border-orange-500 text-orange-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right scroll button */}
          {canScrollRight && (
            <button
              onClick={() => scrollTabs('right')}
              className="shrink-0 flex items-center px-2 text-slate-500 hover:text-slate-200
                         bg-slate-900 border-l border-slate-800 transition-colors z-10"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-5">
        {activeTab === 'activity' && <ActivityTab leadId={lead.id} />}
        {activeTab === 'notes' && <NotesTab leadId={lead.id} userId={userId} userRole={profile.role} />}
        {activeTab === 'audits' && (
          <AuditTab
            leadId={lead.id}
            leadSlug={lead.slug}
            userId={userId}
            userRole={profile.role}
            websiteUrl={lead.website_url}
            businessName={lead.company_name}
            businessType={(lead as any).business_type}
            city={lead.city}
            leadEmail={lead.email ?? ''}
            leadName={lead.name ?? ''}
            leadStatus={lead.status}
            leadNotes={lead.notes}
          />
        )}
        {activeTab === 'appointments' && (
          <AppointmentTab leadId={lead.id} userId={userId} userRole={profile.role} zipCode={lead.zip_code} />
        )}
        {activeTab === 'demo' && (
          <DemoTab leadId={lead.id} leadSlug={lead.slug} companyName={lead.company_name} userId={userId} userRole={profile.role} developers={developers} />
        )}
        {activeTab === 'before-after' && (
          <BeforeAfterTab leadId={lead.id} lead={lead} userId={userId} />
        )}
        {activeTab === 'deal' && (
          <DealTab leadId={lead.id} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'contract' && (
          <ContractTab lead={lead} profile={profile} userId={userId} />
        )}
        {activeTab === 'revisions' && (
          <RevisionTab leadId={lead.id} leadSlug={lead.slug} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'live' && (
          <LiveTab leadId={lead.id} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'website-details' && (
          <WebsiteDetailsTab lead={lead} userId={userId} userRole={profile.role} />
        )}
        {activeTab === 'send-content' && (
          <SendContentTab lead={lead} userId={userId} userRole={profile.role} />
        )}
      </div>
    </div>
  )
}
