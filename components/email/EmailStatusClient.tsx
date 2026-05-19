'use client'
import { useState, useMemo } from 'react'
import {
  Search, MailCheck, MailOpen, Mail, RefreshCw, Pen,
  Building2, User, Calendar, Eye,
} from 'lucide-react'
import { ComposeModal } from '@/components/email/ComposeModal'

interface TrackingInfo {
  first_opened_at: string | null
  last_opened_at: string | null
  opened_count: number
}

interface EmailSendRow {
  id: string
  lead_id: string
  to_email: string
  subject: string
  status: string
  sent_at: string | null
  tracking_token: string | null
  created_at: string
  sender: { full_name: string } | null
  lead: { id: string; name: string; company_name: string; email: string; phone?: string } | null
}

interface Props {
  initialSends: EmailSendRow[]
  initialTrackingMap: Record<string, TrackingInfo>
  userId: string
}

type FilterTab = 'all' | 'opened' | 'not_opened'

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function EmailStatusClient({ initialSends, initialTrackingMap, userId }: Props) {
  const [search, setSearch]           = useState('')
  const [tab, setTab]                 = useState<FilterTab>('all')
  const [composeLead, setComposeLead] = useState<EmailSendRow | null>(null)
  const [refreshKey, setRefreshKey]   = useState(0)

  const filtered = useMemo(() => {
    let data = initialSends
    if (tab === 'opened') {
      data = data.filter(s => {
        const t = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
        return !!t?.first_opened_at
      })
    } else if (tab === 'not_opened') {
      data = data.filter(s => {
        const t = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
        return !t?.first_opened_at
      })
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      data = data.filter(s =>
        (s.lead?.name || '').toLowerCase().includes(q) ||
        (s.lead?.company_name || '').toLowerCase().includes(q) ||
        (s.lead?.phone || '').toLowerCase().includes(q) ||
        (s.to_email || '').toLowerCase().includes(q) ||
        (s.subject || '').toLowerCase().includes(q)
      )
    }
    return data
  }, [initialSends, initialTrackingMap, tab, search])

  const totalSent    = initialSends.length
  const totalOpened  = initialSends.filter(s => {
    const t = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
    return !!t?.first_opened_at
  }).length
  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">

      {/* Top bar */}
      <div className="px-6 py-4 border-b border-slate-800 flex flex-col gap-3 shrink-0">

        {/* Stats */}
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Mail className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-slate-200">{totalSent}</span>
            <span>Total sent</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <MailCheck className="w-4 h-4 text-green-500" />
            <span className="font-medium text-green-400">{totalOpened}</span>
            <span>Opened</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <MailOpen className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-slate-200">{totalSent - totalOpened}</span>
            <span>Not opened</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <Eye className="w-4 h-4 text-orange-400" />
            <span className="font-medium text-orange-400">{openRate}%</span>
            <span>Open rate</span>
          </div>
        </div>

        {/* Search + filter tabs */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by lead, company, phone, email, subject..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1">
            {(['all', 'opened', 'not_opened'] as FilterTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t === 'all' ? 'All' : t === 'opened' ? 'Opened' : 'Not Opened'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            title="Refresh (reload the page to get latest data)"
            className="p-2 text-slate-500 hover:text-slate-300 border border-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
            <Mail className="w-10 h-10 opacity-20" />
            <p className="text-sm">No emails found</p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-[#0E0B24] border-b border-slate-800">
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th scope="col" className="px-4 py-3">Lead</th>
                <th scope="col" className="px-4 py-3">To</th>
                <th scope="col" className="px-4 py-3">Subject</th>
                <th scope="col" className="px-4 py-3">Sent By</th>
                <th scope="col" className="px-4 py-3">Sent Date</th>
                <th scope="col" className="px-4 py-3">Open Status</th>
                <th scope="col" className="px-4 py-3">Opens</th>
                <th scope="col" className="px-4 py-3">Last Opened</th>
                <th scope="col" className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map(s => {
                const tracking = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
                const opened   = !!tracking?.first_opened_at
                return (
                  <tr key={s.id} className="hover:bg-slate-800/30 transition-colors group">
                    {/* Lead */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                          <User size={12} className="text-slate-500 shrink-0" />
                          <span className="truncate max-w-[140px]">{s.lead?.name || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                          <Building2 size={11} className="shrink-0" />
                          <span className="truncate max-w-[140px]">{s.lead?.company_name || '—'}</span>
                        </div>
                      </div>
                    </td>

                    {/* To email */}
                    <td className="px-4 py-3 text-slate-400 text-xs">{s.to_email}</td>

                    {/* Subject */}
                    <td className="px-4 py-3">
                      <span className="text-slate-300 truncate max-w-[200px] block" title={s.subject}>
                        {s.subject}
                      </span>
                    </td>

                    {/* Sent by */}
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {s.sender?.full_name || '—'}
                    </td>

                    {/* Sent date */}
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Calendar size={11} className="text-slate-600" />
                        {fmtDate(s.sent_at || s.created_at)}
                      </div>
                    </td>

                    {/* Open status */}
                    <td className="px-4 py-3">
                      {!s.tracking_token ? (
                        <span className="text-xs text-slate-600">No tracking</span>
                      ) : opened ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400 bg-green-900/30 border border-green-800/40 px-2 py-0.5 rounded-full whitespace-nowrap">
                          <MailCheck className="w-3 h-3" />
                          Opened
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full whitespace-nowrap">
                          <MailOpen className="w-3 h-3" />
                          Not opened
                        </span>
                      )}
                    </td>

                    {/* Open count */}
                    <td className="px-4 py-3 text-center">
                      {tracking?.opened_count ? (
                        <span className="text-green-400 font-semibold text-xs">{tracking.opened_count}×</span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>

                    {/* Last opened */}
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {tracking?.last_opened_at ? (
                        <span title={fmtDateTime(tracking.last_opened_at)}>{timeAgo(tracking.last_opened_at)}</span>
                      ) : '—'}
                    </td>

                    {/* Compose action */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setComposeLead(s)}
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-900/20 hover:bg-orange-900/30 border border-orange-800/40 px-2.5 py-1.5 rounded-lg transition-all whitespace-nowrap"
                      >
                        <Pen size={11} />
                        Compose
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Compose modal */}
      {composeLead && (
        <ComposeModal
          leadId={composeLead.lead_id}
          leadEmail={composeLead.lead?.email || composeLead.to_email}
          leadName={composeLead.lead?.name || ''}
          businessName={composeLead.lead?.company_name || ''}
          userId={userId}
          onClose={() => setComposeLead(null)}
          onSent={() => { setComposeLead(null); setRefreshKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
