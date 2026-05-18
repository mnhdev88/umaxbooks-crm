'use client'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Search, LifeBuoy, Building2, User, Calendar, ChevronRight,
  CheckCircle, Clock, AlertCircle, Loader2, MessageSquare, Phone,
} from 'lucide-react'
import { Profile } from '@/types'
import { cn } from '@/lib/utils'

type TicketStatus = 'open' | 'in_progress' | 'resolved'
type TicketType   = 'revision' | 'bug' | 'content' | 'other'
type FilterTab    = 'all' | TicketStatus

interface TicketLead   { id: string; name: string; company_name: string; phone?: string; email?: string }
interface TicketClient { full_name: string; email?: string }

interface Ticket {
  id: string
  lead_id: string
  client_id: string
  title: string
  description?: string
  type: TicketType
  status: TicketStatus
  developer_note?: string
  created_at: string
  updated_at: string
  lead:   TicketLead   | null
  client: TicketClient | null
}

const TYPE_LABEL: Record<TicketType, string> = {
  revision: 'Revision',
  bug:      'Bug Report',
  content:  'Content Update',
  other:    'Other',
}

const TYPE_COLOR: Record<TicketType, string> = {
  revision: 'bg-blue-500/15 text-blue-400 border-blue-800/40',
  bug:      'bg-red-500/15 text-red-400 border-red-800/40',
  content:  'bg-purple-500/15 text-purple-400 border-purple-800/40',
  other:    'bg-slate-600/30 text-slate-400 border-slate-600/40',
}

const STATUS_COLOR: Record<TicketStatus, string> = {
  open:        'bg-amber-500/15 text-amber-400 border-amber-800/40',
  in_progress: 'bg-blue-500/15 text-blue-400 border-blue-800/40',
  resolved:    'bg-green-500/15 text-green-400 border-green-800/40',
}

const STATUS_ICON: Record<TicketStatus, React.ReactNode> = {
  open:        <AlertCircle className="w-3 h-3" />,
  in_progress: <Clock       className="w-3 h-3" />,
  resolved:    <CheckCircle className="w-3 h-3" />,
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border',
      STATUS_COLOR[status]
    )}>
      {STATUS_ICON[status]}
      {status.replace('_', ' ')}
    </span>
  )
}

function TypeBadge({ type }: { type: TicketType }) {
  return (
    <span className={cn(
      'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border',
      TYPE_COLOR[type]
    )}>
      {TYPE_LABEL[type]}
    </span>
  )
}

interface Props {
  initialTickets: Ticket[]
  profile: Profile
}

export function SupportTicketsClient({ initialTickets, profile }: Props) {
  const supabase = createClient()

  const [tickets, setTickets]       = useState<Ticket[]>(initialTickets)
  const [selectedId, setSelectedId] = useState<string | null>(initialTickets[0]?.id ?? null)
  const [search, setSearch]         = useState('')
  const [tab, setTab]               = useState<FilterTab>('all')
  const [note, setNote]             = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)

  const filtered = useMemo(() => {
    let data = tickets
    if (tab !== 'all') data = data.filter(t => t.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter(t =>
        (t.lead?.company_name || '').toLowerCase().includes(q) ||
        (t.lead?.name         || '').toLowerCase().includes(q) ||
        (t.lead?.phone        || '').toLowerCase().includes(q) ||
        (t.title              || '').toLowerCase().includes(q) ||
        (t.client?.full_name  || '').toLowerCase().includes(q)
      )
    }
    return data
  }, [tickets, tab, search])

  const selected = tickets.find(t => t.id === selectedId) ?? null

  const counts = useMemo(() => ({
    all:         tickets.length,
    open:        tickets.filter(t => t.status === 'open').length,
    in_progress: tickets.filter(t => t.status === 'in_progress').length,
    resolved:    tickets.filter(t => t.status === 'resolved').length,
  }), [tickets])

  async function updateStatus(ticketId: string, status: TicketStatus) {
    setSavingStatus(true)
    const { error } = await supabase
      .from('support_requests')
      .update({ status })
      .eq('id', ticketId)
    if (!error) {
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status } : t))
    }
    setSavingStatus(false)
  }

  async function saveNote(ticketId: string) {
    if (!note.trim()) return
    setSavingNote(true)
    const { error } = await supabase
      .from('support_requests')
      .update({ developer_note: note.trim() })
      .eq('id', ticketId)
    if (!error) {
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, developer_note: note.trim() } : t))
    }
    setSavingNote(false)
  }

  // Sync note textarea when selected ticket changes
  function selectTicket(id: string) {
    setSelectedId(id)
    const t = tickets.find(x => x.id === id)
    setNote(t?.developer_note ?? '')
  }

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all',         label: `All (${counts.all})` },
    { key: 'open',        label: `Open (${counts.open})` },
    { key: 'in_progress', label: `In Progress (${counts.in_progress})` },
    { key: 'resolved',    label: `Resolved (${counts.resolved})` },
  ]

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

      {/* ── Left panel: ticket list ── */}
      <div className="w-80 shrink-0 border-r border-slate-800 flex flex-col bg-[#0a1628]">

        {/* Search */}
        <div className="p-3 border-b border-slate-800">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by company, name, phone..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-3 pt-2 pb-1 flex gap-1 flex-wrap border-b border-slate-800">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                tab === key
                  ? 'bg-orange-500 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Ticket rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 py-12">
              <LifeBuoy className="w-8 h-8 opacity-30" />
              <p className="text-xs">No tickets</p>
            </div>
          ) : (
            filtered.map(t => {
              const isActive = t.id === selectedId
              return (
                <button
                  key={t.id}
                  onClick={() => selectTicket(t.id)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-slate-800/60 transition-colors',
                    isActive ? 'bg-orange-500/10 border-l-2 border-l-orange-500' : 'hover:bg-slate-800/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className={cn('text-xs font-semibold truncate', isActive ? 'text-orange-300' : 'text-slate-200')}>
                      {t.lead?.company_name || t.client?.full_name || '—'}
                    </p>
                    <ChevronRight size={12} className="shrink-0 text-slate-600 mt-0.5" />
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mb-1.5">{t.title}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={t.status} />
                    <TypeBadge type={t.type} />
                  </div>
                  <p className="text-[10px] text-slate-600 mt-1.5">{fmtDate(t.created_at)}</p>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel: ticket detail ── */}
      <div className="flex-1 overflow-y-auto bg-slate-900/30">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
            <LifeBuoy className="w-12 h-12 opacity-20" />
            <p className="text-sm">Select a ticket to view details</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">

            {/* Header */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-xl font-bold text-white leading-snug">{selected.title}</h2>
                <TypeBadge type={selected.type} />
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {fmtDate(selected.created_at)}
                </span>
                {selected.lead?.name && (
                  <span className="flex items-center gap-1">
                    <User size={11} />
                    {selected.lead.name}
                  </span>
                )}
                {selected.lead?.company_name && (
                  <span className="flex items-center gap-1">
                    <Building2 size={11} />
                    {selected.lead.company_name}
                  </span>
                )}
                {selected.lead?.phone && (
                  <span className="flex items-center gap-1">
                    <Phone size={11} />
                    {selected.lead.phone}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            {selected.description && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Client's Message</p>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{selected.description}</p>
              </div>
            )}

            {/* Status */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</p>
              <div className="flex items-center gap-3">
                <StatusBadge status={selected.status} />
                <select
                  disabled={savingStatus}
                  value={selected.status}
                  onChange={e => updateStatus(selected.id, e.target.value as TicketStatus)}
                  className="bg-slate-900 border border-slate-700 text-sm text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                </select>
                {savingStatus && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
              </div>
            </div>

            {/* Reply / Note */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare size={12} />
                Response to Client
              </p>
              {selected.developer_note && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-2">
                  <p className="text-xs text-orange-300 font-medium mb-0.5">Current response (visible to client)</p>
                  <p className="text-xs text-orange-200/80 whitespace-pre-wrap">{selected.developer_note}</p>
                </div>
              )}
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={4}
                placeholder="Write a response for the client..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
              />
              <button
                disabled={savingNote || !note.trim()}
                onClick={() => saveNote(selected.id)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition-colors"
              >
                {savingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare size={14} />}
                {selected.developer_note ? 'Update Response' : 'Send Response'}
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
