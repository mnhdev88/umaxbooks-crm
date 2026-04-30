'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Lead, Profile } from '@/types'
import { cn } from '@/lib/utils'
import { DevBriefTab } from './DevBriefTab'
import { DevAuditTab } from './DevAuditTab'
import { DevDemoTab } from './DevDemoTab'
import { DevBeforeAfterTab } from './DevBeforeAfterTab'
import { DevApprovalTab } from './DevApprovalTab'
import { ActivityTab } from '@/components/leads/tabs/ActivityTab'
import { Button } from '@/components/ui/Button'
import {
  Search, ExternalLink, Code2, Plus,
  FileText, Monitor, BarChart2, CheckSquare, Activity,
  Star,
} from 'lucide-react'

// ── Status display ──────────────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300',
  'Demo Done':      'bg-orange-900/40 text-orange-300',
  'Revision':       'bg-pink-900/40 text-pink-300',
  'Live':           'bg-teal-900/40 text-teal-300',
  'Audit Ready':    'bg-blue-900/40 text-blue-300',
  'Contacted':      'bg-amber-900/40 text-amber-300',
}

const PRIORITY_CLS: Record<string, string> = {
  'Urgent': 'bg-red-900/40 text-red-300',
  'High':   'bg-orange-900/40 text-orange-300',
  'Normal': 'bg-slate-700 text-slate-400',
  'Low':    'bg-slate-800 text-slate-500',
}

// ── TAT countdown ──────────────────────────────────────────────────
function TatPill({ lead }: { lead: any }) {
  const audit = lead.audits?.[0]
  if (!audit) return null
  if (audit.audit_short_pdf_url && audit.audit_long_pdf_url) return null

  const tat = audit.tat_days || 2
  const deadline = new Date(audit.created_at).getTime() + tat * 86400000
  const now = Date.now()
  const remaining = deadline - now

  if (remaining <= 0) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/50 text-red-300 font-bold">OVERDUE</span>
  }
  const hoursLeft = Math.floor(remaining / 3600000)
  const daysLeft = Math.floor(hoursLeft / 24)
  const label = daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`
  const cls = daysLeft === 0 ? 'bg-amber-900/50 text-amber-300' : 'bg-slate-700 text-slate-400'
  return <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', cls)}>{label}</span>
}

// ── Queue type filter ───────────────────────────────────────────────
type Filter = 'all' | 'to-build' | 'submitted'

const FILTER_LABELS: Record<Filter, string> = {
  all:       'All',
  'to-build': 'To Build',
  submitted: 'Submitted',
}

function matchesFilter(lead: any, f: Filter) {
  if (f === 'all') return true
  if (f === 'to-build') return lead.status === 'Demo Scheduled'
  if (f === 'submitted') return lead.status === 'Demo Done'
  return true
}

// ── Tabs ──────────────────────────────────────────────────────────
const TABS = [
  { id: 'brief',      label: 'Lead Brief',     icon: FileText },
  { id: 'audit',      label: 'Audit Reports',  icon: FileText },
  { id: 'demo',       label: 'Demo Site',      icon: Monitor },
  { id: 'beforeafter',label: 'Before/After',   icon: BarChart2 },
  { id: 'approval',   label: 'Approval',       icon: CheckSquare },
  { id: 'activity',   label: 'Log',            icon: Activity },
]

interface Props {
  initialLeads: Lead[]
  agents: Profile[]
  profile: Profile
  userId: string
}

export function DevQueueClient({ initialLeads, agents, profile, userId }: Props) {
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(initialLeads[0]?.id || null)
  const [activeTab, setActiveTab] = useState('brief')

  const filtered = useMemo(() => {
    let list = initialLeads.filter(l => matchesFilter(l, filter))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        l.company_name.toLowerCase().includes(q) ||
        l.name.toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [initialLeads, search, filter])

  const counts = useMemo(() => ({
    all:        initialLeads.length,
    'to-build': initialLeads.filter(l => matchesFilter(l, 'to-build')).length,
    submitted:  initialLeads.filter(l => matchesFilter(l, 'submitted')).length,
  }), [initialLeads])

  const selectedLead = selectedId ? initialLeads.find(l => l.id === selectedId) as any : null

  function selectLead(id: string) {
    setSelectedId(id)
    setActiveTab('brief')
  }

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Left Panel ────────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-slate-800 flex flex-col bg-[#0a1628]">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800">
          <p className="text-sm font-semibold text-slate-100">Developer Queue</p>
          <p className="text-xs text-slate-500 mt-0.5">{initialLeads.length} leads assigned</p>
        </div>

        {/* Filter chips */}
        <div className="px-3 py-2.5 border-b border-slate-800 flex gap-1.5 flex-wrap">
          {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors',
                filter === f
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              )}
            >
              {FILTER_LABELS[f]}
              {counts[f] > 0 && <span className="ml-1 opacity-70">{counts[f]}</span>}
            </button>
          ))}
        </div>

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

        {/* Lead list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-500">No leads found.</div>
          )}
          {filtered.map(lead => {
            const isSelected = lead.id === selectedId
            const priority = (lead as any).priority
            return (
              <button
                key={lead.id}
                onClick={() => selectLead(lead.id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-slate-800 transition-all',
                  isSelected
                    ? 'bg-orange-900/20 border-l-2 border-l-orange-500 pl-3.5'
                    : 'hover:bg-slate-800/50 border-l-2 border-l-transparent'
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className={cn('text-sm font-medium truncate flex-1 mr-2', isSelected ? 'text-orange-300' : 'text-slate-200')}>
                    {lead.company_name}
                  </p>
                  <TatPill lead={lead} />
                </div>
                <p className="text-xs text-slate-500 mb-2 truncate">{lead.name} · {lead.city || '—'}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', STATUS_CLS[lead.status] || 'bg-slate-700 text-slate-400')}>
                    {lead.status}
                  </span>
                  {priority && priority !== 'Normal' && (
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', PRIORITY_CLS[priority] || 'bg-slate-700 text-slate-400')}>
                      {priority}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right Panel ───────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-950">
        {!selectedLead ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Code2 size={40} className="opacity-20" />
            <p className="text-sm">Select a lead from the queue</p>
          </div>
        ) : selectedLead ? (
          // ── Regular lead detail ───────────────────────────
          <>
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
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', STATUS_CLS[selectedLead.status] || 'bg-slate-700 text-slate-400')}>
                  {selectedLead.status}
                </span>
                <Link href={`/leads/${selectedLead.id}`}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 border border-slate-700 hover:border-orange-700 rounded-lg px-2.5 py-1.5 transition-colors">
                  Open Lead <ExternalLink size={11} />
                </Link>
              </div>
            </div>

            {/* Tab nav */}
            <div className="flex border-b border-slate-800 flex-shrink-0 bg-slate-900/50 overflow-x-auto">
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

            <div className="flex-1 overflow-y-auto p-5" key={selectedLead.id + '-' + activeTab}>
              {activeTab === 'brief' && <DevBriefTab lead={selectedLead} />}
              {activeTab === 'audit' && (
                <DevAuditTab
                  leadId={selectedLead.id}
                  leadSlug={selectedLead.slug}
                  userId={userId}
                  websiteUrl={selectedLead.website_url}
                  businessName={selectedLead.company_name}
                  city={selectedLead.city}
                />
              )}
              {activeTab === 'demo' && (
                <DevDemoTab
                  leadId={selectedLead.id}
                  leadSlug={selectedLead.slug}
                  userId={userId}
                  companyName={selectedLead.company_name}
                />
              )}
              {activeTab === 'beforeafter' && (
                <DevBeforeAfterTab
                  leadId={selectedLead.id}
                  leadSlug={selectedLead.slug}
                  userId={userId}
                />
              )}
              {activeTab === 'approval' && (
                <DevApprovalTab
                  leadId={selectedLead.id}
                  userId={userId}
                  userRole={profile.role}
                  agents={agents}
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
        ) : null}
      </div>
    </div>
  )
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
        placeholder="Log a note, call, or dev update..."
        rows={2}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none mb-2"
      />
      <div className="flex gap-2">
        <select
          value={type}
          onChange={e => setType(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer"
        >
          {['Note', 'Code Update', 'Bug Fix', 'Design Change', 'Testing', 'Other'].map(t => (
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
