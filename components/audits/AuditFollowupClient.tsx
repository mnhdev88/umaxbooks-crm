'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Lead, Profile } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { AuditTab } from '@/components/leads/tabs/AuditTab'
import { SendContentTab } from '@/components/leads/tabs/SendContentTab'
import { ActivityTab } from '@/components/leads/tabs/ActivityTab'
import { FollowupTab } from './FollowupTab'
import {
  Search, ExternalLink, AlertTriangle, Star, Plus, ChevronRight,
  Activity, Send, FileText, Users, CheckCircle,
} from 'lucide-react'

// ── Status helpers ─────────────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  'Contacted':      'bg-amber-900/40 text-amber-300 border border-amber-800/30',
  'Audit Ready':    'bg-blue-900/40 text-blue-300 border border-blue-800/30',
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300 border border-purple-800/30',
  'Demo Done':      'bg-orange-900/40 text-orange-300 border border-orange-800/30',
  'Revision':       'bg-pink-900/40 text-pink-300 border border-pink-800/30',
  'Live':           'bg-teal-900/40 text-teal-300 border border-teal-800/30',
}

function auditStatusLabel(lead: any): { label: string; cls: string } {
  const audit = lead.audits?.[0]
  if (!audit) {
    if (lead.status === 'Demo Scheduled') return { label: 'Meeting Scheduled', cls: 'bg-purple-900/30 text-purple-300' }
    if (lead.status === 'Demo Done')      return { label: 'Demo Done',         cls: 'bg-orange-900/30 text-orange-300' }
    return { label: lead.status, cls: STATUS_CLS[lead.status] || 'bg-slate-700 text-slate-300' }
  }
  if (audit.audit_short_pdf_url && audit.audit_long_pdf_url) return { label: 'Audit Done',      cls: 'bg-green-900/30 text-green-300' }
  if (audit.audit_short_pdf_url)                              return { label: 'Summary Uploaded', cls: 'bg-teal-900/30 text-teal-300' }
  return { label: 'Audit Requested', cls: 'bg-amber-900/30 text-amber-300' }
}

function isOverdue(lead: any): boolean {
  const audit = lead.audits?.[0]
  if (!audit || audit.audit_short_pdf_url) return false
  const tat = audit.tat_days || 2
  const due = new Date(audit.created_at)
  due.setDate(due.getDate() + tat)
  return new Date() > due
}

// ── Manual Activity Entry ──────────────────────────────────────────
function ManualActivityEntry({ leadId, userId }: { leadId: string; userId: string }) {
  const supabase = createClient()
  const [text, setText] = useState('')
  const [type, setType] = useState('Note')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!text.trim()) return
    setSaving(true)
    await supabase.from('activity_logs').insert({
      lead_id: leadId, user_id: userId,
      action: type, details: text.trim(),
    })
    setText('')
    setSaving(false)
  }

  return (
    <div className="mt-5 pt-5 border-t border-slate-800">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Manual Entry</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Log a call, meeting, or note manually..."
        rows={2}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none mb-2"
      />
      <div className="flex gap-2">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer"
        >
          {['Note', 'Call', 'Email sent', 'WhatsApp sent', 'Meeting', 'Other'].map(t => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <Button size="sm" onClick={submit} loading={saving} disabled={!text.trim()}>
          <Plus size={12} /> Add Entry
        </Button>
      </div>
    </div>
  )
}

// ── Tab definitions ────────────────────────────────────────────────
const TABS = [
  { id: 'audit',    label: 'SEO Audit',    icon: FileText },
  { id: 'followup', label: 'Follow-up',    icon: CheckCircle },
  { id: 'content',  label: 'Send Content', icon: Send },
  { id: 'activity', label: 'Activity Log', icon: Activity },
]

interface Props {
  initialLeads: Lead[]
  agents: Profile[]
  profile: Profile
  userId: string
}

export function AuditFollowupClient({ initialLeads, agents, profile, userId }: Props) {
  const [search, setSearch]           = useState('')
  const [selectedId, setSelectedId]   = useState<string | null>(
    initialLeads.length > 0 ? initialLeads[0].id : null
  )
  const [activeTab, setActiveTab]     = useState('audit')

  // Filtered lead list
  const filtered = useMemo(() => {
    if (!search.trim()) return initialLeads
    const q = search.toLowerCase()
    return initialLeads.filter(l =>
      l.company_name.toLowerCase().includes(q) ||
      l.name.toLowerCase().includes(q) ||
      (l.city || '').toLowerCase().includes(q)
    )
  }, [initialLeads, search])

  const selectedLead = initialLeads.find(l => l.id === selectedId) as any

  const overdueCount = initialLeads.filter(l => isOverdue(l)).length

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Left Panel: Lead List ─────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-slate-800 flex flex-col bg-[#0a1628]">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800">
          <p className="text-sm font-semibold text-slate-100">Leads in Audit / Follow-up</p>
          <p className="text-xs text-slate-500 mt-0.5">Click a lead to manage</p>
        </div>

        {/* Overdue alert */}
        {overdueCount > 0 && (
          <div className="mx-3 mt-3 flex items-center gap-2 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={12} className="flex-shrink-0" />
            {overdueCount} audit{overdueCount > 1 ? 's' : ''} overdue TAT
          </div>
        )}

        {/* Search */}
        <div className="relative px-3 py-2.5 border-b border-slate-800">
          <Search size={12} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Lead rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-500">No leads found.</div>
          )}
          {filtered.map(lead => {
            const overdue = isOverdue(lead)
            const { label, cls } = auditStatusLabel(lead)
            const step = (lead as any).follow_up_step || 0
            const isSelected = lead.id === selectedId

            return (
              <button
                key={lead.id}
                onClick={() => { setSelectedId(lead.id); setActiveTab('audit') }}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-slate-800 transition-all',
                  isSelected
                    ? 'bg-orange-900/20 border-l-2 border-l-orange-500 pl-3.5'
                    : 'hover:bg-slate-800/50 border-l-2 border-l-transparent'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className={cn('text-sm font-medium', isSelected ? 'text-orange-300' : 'text-slate-200')}>
                    {lead.company_name}
                  </p>
                  {overdue && (
                    <span className="text-xs font-bold text-red-400">OVERDUE</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 flex-wrap">
                  <span>{lead.name}</span>
                  <span>·</span>
                  <span>{lead.city || '—'}</span>
                  {step > 0 && <>
                    <span>·</span>
                    <span>Step {step}/5</span>
                  </>}
                </div>
                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cls)}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right Panel: Detail ───────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-950">
        {!selectedLead ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Users size={40} className="opacity-20" />
            <p className="text-sm">Select a lead from the list to view details</p>
          </div>
        ) : (
          <>
            {/* Lead summary bar */}
            <div className="px-5 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <p className="text-sm font-semibold text-slate-100">{selectedLead.company_name}</p>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  {selectedLead.website_url && (
                    <a href={selectedLead.website_url} target="_blank" rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 hover:underline">
                      {selectedLead.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {selectedLead.website_url && <span>·</span>}
                  {selectedLead.city && <span>{selectedLead.city}</span>}
                  {selectedLead.gmb_review_rating && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-0.5 text-yellow-400">
                        <Star size={10} fill="currentColor" /> {selectedLead.gmb_review_rating}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium',
                  auditStatusLabel(selectedLead).cls)}>
                  {auditStatusLabel(selectedLead).label}
                </span>
                <Link href={`/leads/${selectedLead.id}`}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 border border-slate-700 hover:border-orange-700 rounded-lg px-2.5 py-1.5 transition-colors">
                  Open Lead <ExternalLink size={11} />
                </Link>
              </div>
            </div>

            {/* Tab nav */}
            <div className="flex border-b border-slate-800 flex-shrink-0 bg-slate-900/50">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap',
                    activeTab === t.id
                      ? 'border-orange-500 text-orange-400'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  )}
                >
                  <t.icon size={13} />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content — keyed so it remounts when lead changes */}
            <div className="flex-1 overflow-y-auto p-5" key={selectedLead.id + '-' + activeTab}>

              {activeTab === 'audit' && (
                <AuditTab
                  leadId={selectedLead.id}
                  leadSlug={selectedLead.slug}
                  userId={userId}
                  userRole={profile.role}
                  websiteUrl={selectedLead.website_url}
                  businessName={selectedLead.company_name}
                  city={selectedLead.city}
                />
              )}

              {activeTab === 'followup' && (
                <FollowupTab
                  leadId={selectedLead.id}
                  companyName={selectedLead.company_name}
                  userId={userId}
                  userRole={profile.role}
                />
              )}

              {activeTab === 'content' && (
                <SendContentTab
                  lead={selectedLead as Lead}
                  userId={userId}
                  userRole={profile.role}
                />
              )}

              {activeTab === 'activity' && (
                <>
                  <ActivityTab leadId={selectedLead.id} />
                  <ManualActivityEntry leadId={selectedLead.id} userId={userId} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
