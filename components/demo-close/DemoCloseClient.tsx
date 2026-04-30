'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Lead, Profile, DealClosing } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { ZoomPrepTab } from './ZoomPrepTab'
import { BeforeAfterViewTab } from './BeforeAfterViewTab'
import { CloseDealTab } from './CloseDealTab'
import { ObjectionHandlerTab } from './ObjectionHandlerTab'
import { ActivityTab } from '@/components/leads/tabs/ActivityTab'
import { Button } from '@/components/ui/Button'
import {
  Search, ExternalLink, Star, Video, CheckCircle,
  BarChart2, XCircle, MonitorPlay, Activity, Plus, Users,
} from 'lucide-react'

// ── Status / badge helpers ──────────────────────────────────────────
const STATUS_CLS: Record<string, string> = {
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300',
  'Demo Done':      'bg-orange-900/40 text-orange-300',
  'Closed Won':     'bg-green-900/40 text-green-300',
  'Lost':           'bg-red-900/30 text-red-400',
  'Revision':       'bg-pink-900/40 text-pink-300',
}

function closingBadge(lead: any): { label: string; cls: string } {
  const closing = lead.deal_closings?.[0]
  const approval = lead.demo_approvals?.[0]
  const hasAppointment = !!lead.appointments?.[0]?.appointment_datetime

  if (closing?.outcome === 'won')  return { label: 'Closed Won',      cls: 'bg-green-900/30 text-green-300' }
  if (closing?.outcome === 'lost') return { label: 'Not Closed',      cls: 'bg-red-900/25 text-red-400' }
  if (hasAppointment)              return { label: 'Zoom Scheduled',  cls: 'bg-purple-900/30 text-purple-300' }
  if (approval?.status === 'approved') return { label: 'Demo Approved', cls: 'bg-teal-900/30 text-teal-300' }
  return { label: lead.status, cls: STATUS_CLS[lead.status] || 'bg-slate-700 text-slate-400' }
}

// ── Tabs ────────────────────────────────────────────────────────────
const TABS = [
  { id: 'prep',        label: 'Zoom Prep',       icon: Video },
  { id: 'compare',     label: 'Before / After',  icon: BarChart2 },
  { id: 'close',       label: 'Close Deal',      icon: CheckCircle },
  { id: 'objections',  label: 'Objection Handler', icon: XCircle },
  { id: 'log',         label: 'Call Log',        icon: Activity },
]

interface Props {
  initialLeads: Lead[]
  profile: Profile
  userId: string
  initialClosings: Record<string, DealClosing>
  initialComparisons: Record<string, any>
  initialMetrics: Record<string, any[]>
}

export function DemoCloseClient({ initialLeads, profile, userId, initialClosings, initialComparisons, initialMetrics }: Props) {
  const supabase = createClient()
  const [search, setSearch]       = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(
    initialLeads.length > 0 ? initialLeads[0].id : null
  )
  const [activeTab, setActiveTab] = useState('prep')
  const [closings, setClosings]   = useState(initialClosings)

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
  const closing = selectedId ? closings[selectedId] || null : null
  const comparison = selectedId ? initialComparisons[selectedId] || null : null
  const metrics = selectedId ? initialMetrics[selectedId] || [] : []

  async function saveChecklist(checklist: Record<string, boolean>) {
    if (!selectedId) return
    const existing = closings[selectedId]
    if (existing?.id) {
      await supabase.from('deal_closings').update({ prep_checklist: checklist, updated_at: new Date().toISOString() }).eq('id', existing.id)
      setClosings(prev => ({ ...prev, [selectedId]: { ...existing, prep_checklist: checklist } }))
    } else {
      const { data } = await supabase.from('deal_closings').insert({ lead_id: selectedId, prep_checklist: checklist }).select().single()
      if (data) setClosings(prev => ({ ...prev, [selectedId]: data as DealClosing }))
    }
  }

  function onClosingUpdated() {
    // Re-fetch this lead's closing data
    supabase.from('deal_closings').select('*').eq('lead_id', selectedId).maybeSingle().then(({ data }) => {
      if (data && selectedId) setClosings(prev => ({ ...prev, [selectedId]: data as DealClosing }))
    })
  }

  const approvedCount = initialLeads.filter(l => {
    const a = (l as any).demo_approvals?.[0]
    return a?.status === 'approved' && !(l as any).deal_closings?.[0]?.outcome
  }).length

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Left Panel ─────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-slate-800 flex flex-col bg-[#0a1628]">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-800">
          <p className="text-sm font-semibold text-slate-100">Demo & Close</p>
          <p className="text-xs text-slate-500 mt-0.5">Approved demos · Present · Close</p>
        </div>

        {approvedCount > 0 && (
          <div className="mx-3 mt-3 flex items-center gap-2 bg-teal-900/20 border border-teal-700/30 rounded-lg px-3 py-2 text-xs text-teal-300">
            <CheckCircle size={12} className="flex-shrink-0" />
            {approvedCount} demo{approvedCount > 1 ? 's' : ''} approved and ready to show
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

        {/* Lead list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-xs text-slate-500">No leads found.</div>
          )}
          {filtered.map(lead => {
            const isSelected = lead.id === selectedId
            const { label, cls } = closingBadge(lead)
            const appointment = (lead as any).appointments?.[0]
            const meetingTime = appointment?.appointment_datetime
              ? new Date(appointment.appointment_datetime).toLocaleDateString([], { day: 'numeric', month: 'short' }) +
                ' · ' + new Date(appointment.appointment_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : null

            return (
              <button
                key={lead.id}
                onClick={() => { setSelectedId(lead.id); setActiveTab('prep') }}
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
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0', cls)}>{label}</span>
                </div>
                <p className="text-xs text-slate-500 mb-1.5 truncate">{lead.name} · {lead.city || '—'}</p>
                {meetingTime && (
                  <p className="text-xs text-purple-400 flex items-center gap-1">
                    <Video size={10} /> {meetingTime}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Right Panel ──────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-slate-950">
        {!selectedLead ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Users size={40} className="opacity-20" />
            <p className="text-sm">Select a lead from the list to manage</p>
          </div>
        ) : (
          <>
            {/* Summary bar */}
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
                  {selectedLead.city && <><span>·</span><span>{selectedLead.city}</span></>}
                  {selectedLead.gmb_review_rating && (
                    <><span>·</span><span className="flex items-center gap-0.5 text-yellow-400"><Star size={10} fill="currentColor" /> {selectedLead.gmb_review_rating}</span></>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', closingBadge(selectedLead).cls)}>
                  {closingBadge(selectedLead).label}
                </span>
                <Link href={`/leads/${selectedLead.id}`}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 border border-slate-700 hover:border-orange-700 rounded-lg px-2.5 py-1.5 transition-colors">
                  Open Lead <ExternalLink size={11} />
                </Link>
              </div>
            </div>

            {/* Tabs */}
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

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5" key={selectedLead.id + '-' + activeTab}>

              {activeTab === 'prep' && (
                <ZoomPrepTab
                  lead={selectedLead}
                  userId={userId}
                  closing={closing}
                  comparison={comparison}
                  metrics={metrics}
                  onChecklistSave={saveChecklist}
                />
              )}

              {activeTab === 'compare' && (
                <BeforeAfterViewTab
                  lead={selectedLead}
                  comparison={comparison}
                  metrics={metrics}
                />
              )}

              {activeTab === 'close' && (
                <CloseDealTab
                  leadId={selectedLead.id}
                  userId={userId}
                  closing={closing}
                  onClose={onClosingUpdated}
                />
              )}

              {activeTab === 'objections' && <ObjectionHandlerTab />}

              {activeTab === 'log' && (
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

// ── Manual activity entry ───────────────────────────────────────────
function ManualActivityEntry({ leadId, userId }: { leadId: string; userId: string }) {
  const supabase = createClient()
  const [text, setText] = useState('')
  const [type, setType] = useState('Call')
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
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Add Call Note</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Log a call, note, or update..."
        rows={2}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none mb-2"
      />
      <div className="flex gap-2">
        <select value={type} onChange={e => setType(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer">
          {['Call', 'Note', 'Email', 'WhatsApp', 'Meeting'].map(t => <option key={t}>{t}</option>)}
        </select>
        <Button size="sm" onClick={submit} loading={saving} disabled={!text.trim()}>
          <Plus size={12} /> Add Entry
        </Button>
      </div>
    </div>
  )
}
