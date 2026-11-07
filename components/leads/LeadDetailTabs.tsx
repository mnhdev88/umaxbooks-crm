'use client'

import { useState, useRef, useEffect } from 'react'
import { Lead, Profile } from '@/types'
import { AuditTab } from './tabs/AuditTab'
import { AppointmentTab } from './tabs/AppointmentTab'
import { DemoTab } from './tabs/DemoTab'
import { DealTab } from './tabs/DealTab'
import { RevisionTab } from './tabs/RevisionTab'
import { LiveTab } from './tabs/LiveTab'
import { ActivityTab } from './tabs/ActivityTab'
import { CallsTab } from './tabs/CallsTab'
import { SmsTab } from './tabs/SmsTab'
import { NotesTab } from './tabs/NotesTab'
import { SendContentTab } from './tabs/SendContentTab'
import { BeforeAfterTab } from './tabs/BeforeAfterTab'
import { ContractTab } from '@/components/contracts/ContractTab'
import { WebsiteDetailsTab } from './tabs/WebsiteDetailsTab'
import { ShareTab } from './tabs/ShareTab'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

// sales_manager has the same lead-working tabs as sales_agent (everything except the
// admin-only Client Portal) — they oversee and can step in for their team's leads.
//
// Order = how often agents reach for them. Notes is first and the default (what you
// check before/after every call). `more: true` tabs live in a "More" menu so the
// bar fits a laptop screen without sideways scrolling.
const ALL_TABS: { id: string; label: string; roles: string[]; more?: boolean }[] = [
  { id: 'notes',           label: 'Notes',           roles: ['admin', 'agent', 'sales_agent', 'sales_manager', 'developer'] },
  { id: 'activity',        label: 'Activity',        roles: ['admin', 'agent', 'sales_agent', 'sales_manager', 'developer'] },
  { id: 'calls',           label: 'AI Calls',        roles: ['admin', 'agent', 'sales_agent', 'sales_manager'] },
  { id: 'sms',             label: 'SMS',             roles: ['admin', 'agent', 'sales_agent', 'sales_manager'] },
  { id: 'appointments',    label: 'Calls & Appts',   roles: ['admin', 'sales_agent', 'sales_manager'] },
  { id: 'audits',          label: 'Audits',          roles: ['admin', 'agent', 'sales_agent', 'sales_manager', 'developer'] },
  { id: 'demo',            label: 'Demo',            roles: ['admin', 'sales_agent', 'sales_manager', 'developer'] },
  { id: 'deal',            label: 'Deal',            roles: ['admin', 'sales_agent', 'sales_manager'] },
  { id: 'contract',        label: 'Contract',        roles: ['admin', 'sales_agent', 'sales_manager'], more: true },
  { id: 'share',           label: 'Client Link',     roles: ['admin', 'sales_agent', 'sales_manager'], more: true },
  { id: 'revisions',       label: 'Revisions',       roles: ['admin', 'sales_agent', 'sales_manager'], more: true },
  { id: 'live',            label: 'Live',            roles: ['admin', 'sales_agent', 'sales_manager'], more: true },
  { id: 'before-after',    label: 'Before / After',  roles: ['admin', 'sales_agent', 'sales_manager'], more: true },
  { id: 'website-details', label: 'Client Portal',   roles: ['admin'], more: true },
  { id: 'send-content',    label: 'Send Content',    roles: ['admin', 'sales_agent', 'sales_manager', 'developer'], more: true },
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
  const PRIMARY = TABS.filter(t => !t.more)
  const MORE    = TABS.filter(t => t.more)
  const defaultTab = (initialTab && TABS.find(t => t.id === initialTab))
    ? initialTab
    : TABS[0]?.id || 'activity'
  const [activeTab, setActiveTab] = useState(defaultTab)
  const [moreOpen, setMoreOpen]   = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const activeMore = MORE.find(t => t.id === activeTab)

  // Close the "More" menu on outside click / Escape
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false) }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const tabCls = (active: boolean) => cn(
    'px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
    active ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-500 hover:text-slate-300'
  )

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl">
      {/* Tab nav */}
      <div className="border-b border-slate-800">
        {/* Mobile: dropdown */}
        <div className="flex items-center gap-2 px-3 py-2 md:hidden">
          <select
            value={activeTab}
            onChange={e => setActiveTab(e.target.value)}
            aria-label="Lead section"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500"
          >
            {PRIMARY.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
            {MORE.length > 0 && (
              <optgroup label="More">
                {MORE.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
              </optgroup>
            )}
          </select>
        </div>

        {/* Desktop: core tabs + "More" menu (no sideways scrolling) */}
        <div className="hidden md:flex items-stretch flex-wrap px-1" role="tablist">
          {PRIMARY.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={tabCls(activeTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
          {MORE.length > 0 && (
            <div ref={moreRef} className="relative flex">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(o => !o)}
                className={cn(tabCls(!!activeMore), 'inline-flex items-center gap-1')}
              >
                {activeMore ? activeMore.label : 'More'}
                <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform', moreOpen && 'rotate-180')} />
              </button>
              {moreOpen && (
                <div role="menu" className="absolute left-0 top-full z-40 mt-1 min-w-44 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl shadow-black/40">
                  {MORE.map(tab => (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      onClick={() => { setActiveTab(tab.id); setMoreOpen(false) }}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer',
                        activeTab === tab.id ? 'bg-orange-500/15 text-orange-400 font-medium' : 'text-slate-300 hover:bg-slate-800'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-3 sm:p-5">
        {activeTab === 'activity' && <ActivityTab leadId={lead.id} />}
        {activeTab === 'calls' && <CallsTab leadId={lead.id} />}
        {activeTab === 'sms' && (
          <SmsTab leadId={lead.id} phone={lead.phone} altPhones={lead.alt_phones} name={lead.name} />
        )}
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
            leadAltEmails={lead.alt_emails}
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
        {activeTab === 'share' && (
          <ShareTab lead={lead} profile={profile} userId={userId} />
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
