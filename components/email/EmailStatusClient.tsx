'use client'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, MailCheck, Mail, RefreshCw, Pen, RotateCcw,
  Building2, User, Calendar, Eye, CheckCircle2, XCircle, AlertTriangle,
  Clock, UserMinus, MousePointerClick, X, CloudDownload,
  MapPin, ShieldQuestion, Monitor,
} from 'lucide-react'
import { ComposeModal } from '@/components/email/ComposeModal'

interface TrackingInfo {
  first_opened_at: string | null
  last_opened_at: string | null
  opened_count: number
  last_open_ip: string | null
  last_open_location: string | null
  last_open_is_proxy: boolean | null
}

interface EngagementEvent {
  id: string
  event_type: 'open' | 'click'
  ip: string | null
  user_agent: string | null
  is_proxy: boolean
  proxy_name: string | null
  geo_city: string | null
  geo_region: string | null
  geo_country: string | null
  clicked_url: string | null
  created_at: string
}

interface EmailSendRow {
  id: string
  lead_id: string
  to_email: string
  subject: string
  html_body?: string | null
  status: string
  sent_at: string | null
  tracking_token: string | null
  created_at: string
  // delivery tracking
  delivered_at: string | null
  bounced_at: string | null
  bounce_type: string | null
  deferred_at: string | null
  unsubscribed_at: string | null
  // click tracking
  click_count: number | null
  first_clicked_at: string | null
  last_clicked_url: string | null
  sender: { full_name: string } | null
  lead: { id: string; name: string; company_name: string; email: string; phone?: string } | null
}

interface Props {
  initialSends: EmailSendRow[]
  initialTrackingMap: Record<string, TrackingInfo>
  userId: string
}

type FilterTab = 'all' | 'opened' | 'not_opened' | 'clicked' | 'delivered' | 'bounced' | 'deferred' | 'spam' | 'unsubscribed'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',          label: 'All' },
  { key: 'opened',       label: 'Opened' },
  { key: 'not_opened',   label: 'Not Opened' },
  { key: 'clicked',      label: 'Clicked' },
  { key: 'delivered',    label: 'Delivered' },
  { key: 'bounced',      label: 'Bounced' },
  { key: 'deferred',     label: 'Deferred' },
  { key: 'spam',         label: 'Spam' },
  { key: 'unsubscribed', label: 'Unsubscribed' },
]

// Human label for a mail-provider image proxy.
const PROXY_LABELS: Record<string, string> = {
  gmail:              'Gmail proxy',
  apple:              'Apple Mail Privacy',
  outlook:            'Outlook proxy',
  yahoo:              'Yahoo proxy',
  'security-scanner': 'Security scanner',
}

/**
 * Formats a resolved location. Returns null when there is nothing trustworthy to show
 * so callers can fall back rather than rendering an empty pill.
 */
function formatLocation(e: { geo_city: string | null; geo_region: string | null; geo_country: string | null }) {
  const parts = [e.geo_city, e.geo_region, e.geo_country].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/**
 * Location of the most recent open.
 *
 * Deliberately three-state. Gmail, Apple Mail Privacy Protection and Outlook fetch the
 * tracking pixel through their own servers, so the recorded IP is a datacenter and its
 * city says nothing about the lead. Showing that as a location would have reps reading
 * "Council Bluffs, Iowa" as fact, so proxied opens render as hidden instead. Clicks are
 * unaffected — those come from the recipient's real browser.
 */
function OpenLocation({ tracking }: { tracking: TrackingInfo | null }) {
  if (!tracking?.first_opened_at) return <span className="text-slate-600">—</span>

  if (tracking.last_open_is_proxy) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap"
        title="This email was opened through a mail provider's image proxy, which hides the recipient's real location. Link clicks still show a real location."
      >
        <ShieldQuestion className="w-3 h-3 text-slate-500" /> Hidden
      </span>
    )
  }

  if (tracking.last_open_location) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-300 whitespace-nowrap" title={tracking.last_open_ip || undefined}>
        <MapPin className="w-3 h-3 text-orange-400" /> {tracking.last_open_location}
      </span>
    )
  }

  // Real (non-proxy) IP captured, but geolocation hasn't been resolved yet.
  if (tracking.last_open_ip) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap font-mono" title="IP captured; location not resolved yet">
        <MapPin className="w-3 h-3 text-slate-500" /> {tracking.last_open_ip}
      </span>
    )
  }

  return <span className="text-slate-600">—</span>
}

/** Condense a user agent to something a sales rep can read at a glance. */
function shortClient(ua: string | null): string | null {
  if (!ua) return null
  const browser =
    /Edg\//.test(ua)     ? 'Edge' :
    /OPR\//.test(ua)     ? 'Opera' :
    /Chrome\//.test(ua)  ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua)  ? 'Safari' :
    /Outlook/i.test(ua)  ? 'Outlook' :
    /Thunderbird/i.test(ua) ? 'Thunderbird' : null
  const os =
    /Windows/i.test(ua)          ? 'Windows' :
    /iPhone|iPad|iOS/i.test(ua)  ? 'iOS' :
    /Mac OS X|Macintosh/i.test(ua) ? 'macOS' :
    /Android/i.test(ua)          ? 'Android' :
    /Linux/i.test(ua)            ? 'Linux' : null
  const parts = [browser, os].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * Per-event engagement timeline for the drawer. This is what the counters can't show:
 * five opens from three different places, and which links were actually clicked.
 */
function EngagementTimeline({ events, loading }: { events: EngagementEvent[]; loading: boolean }) {
  if (loading) {
    return <p className="text-xs text-slate-500 px-1 py-2">Loading activity…</p>
  }
  if (events.length === 0) {
    return <p className="text-xs text-slate-500 px-1 py-2">No opens or clicks recorded yet.</p>
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map(e => {
        const isClick  = e.event_type === 'click'
        const location = formatLocation(e)
        const client   = shortClient(e.user_agent)
        return (
          <li key={e.id} className="flex gap-2 text-xs">
            <div className="pt-0.5 shrink-0">
              {isClick
                ? <MousePointerClick className="w-3.5 h-3.5 text-violet-400" />
                : <MailCheck className="w-3.5 h-3.5 text-green-400" />}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={isClick ? 'text-violet-300 font-medium' : 'text-green-300 font-medium'}>
                  {isClick ? 'Clicked' : 'Opened'}
                </span>
                <span className="text-slate-500" title={fmtDateTime(e.created_at)}>
                  {timeAgo(e.created_at)}
                </span>
              </div>

              {isClick && e.clicked_url && (
                <span className="text-slate-400 truncate max-w-[380px]" title={e.clicked_url}>
                  {e.clicked_url}
                </span>
              )}

              {/* Location line. A proxied open is labelled, never geolocated — the IP
                  belongs to the mail provider, not the lead. */}
              {e.is_proxy ? (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <ShieldQuestion className="w-3 h-3" />
                  Location hidden{e.proxy_name ? ` · ${PROXY_LABELS[e.proxy_name] || e.proxy_name}` : ''}
                </span>
              ) : location ? (
                <span className="inline-flex items-center gap-1 text-slate-300">
                  <MapPin className="w-3 h-3 text-orange-400" />
                  {location}
                  {e.ip && <span className="text-slate-600 font-mono">· {e.ip}</span>}
                </span>
              ) : e.ip ? (
                <span className="inline-flex items-center gap-1 text-slate-400 font-mono">
                  <MapPin className="w-3 h-3 text-slate-500" />
                  {e.ip}
                </span>
              ) : null}

              {client && (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <Monitor className="w-3 h-3" />
                  {client}
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function DeliveryBadge({ status, bounceType }: { status: string; bounceType?: string | null }) {
  if (status === 'delivered') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-900/30 border border-emerald-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <CheckCircle2 className="w-3 h-3" /> Delivered
    </span>
  )
  if (status === 'bounced') {
    const label = bounceType === 'hard' ? 'Hard Bounce' : bounceType === 'soft' ? 'Soft Bounce' : 'Bounced'
    const isSoft = bounceType === 'soft'
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap w-fit ${
        isSoft
          ? 'text-orange-400 bg-orange-900/30 border border-orange-800/40'
          : 'text-red-400 bg-red-900/30 border border-red-800/40'
      }`}>
        <XCircle className="w-3 h-3" /> {label}
      </span>
    )
  }
  if (status === 'spam') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-900/30 border border-amber-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <AlertTriangle className="w-3 h-3" /> Spam
    </span>
  )
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 bg-red-900/30 border border-red-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <XCircle className="w-3 h-3" /> Failed
    </span>
  )
  if (status === 'deferred') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 bg-sky-900/30 border border-sky-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <Clock className="w-3 h-3" /> Deferred
    </span>
  )
  if (status === 'unsubscribed') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800/60 border border-slate-600/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <UserMinus className="w-3 h-3" /> Unsubscribed
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
      <Mail className="w-3 h-3" /> Sent
    </span>
  )
}

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
  const router = useRouter()
  const [search, setSearch]             = useState('')
  const [tab, setTab]                   = useState<FilterTab>('all')
  const [selectedEmail, setSelectedEmail] = useState<EmailSendRow | null>(null)
  const [engagement, setEngagement]             = useState<EngagementEvent[]>([])
  const [engagementLoading, setEngagementLoading] = useState(false)
  const [composeLead, setComposeLead]   = useState<EmailSendRow | null>(null)
  const [resendTarget, setResendTarget] = useState<EmailSendRow | null>(null)
  const [syncing, setSyncing]           = useState(false)
  const [syncMsg, setSyncMsg]           = useState<string | null>(null)

  const syncFromResend = useCallback(async () => {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res  = await fetch('/api/email/sync-resend', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setSyncMsg(data.error || 'Sync failed')
      } else {
        setSyncMsg(data.message)
        if (data.synced > 0) router.refresh()
      }
    } catch {
      setSyncMsg('Sync failed — check your connection')
    } finally {
      setSyncing(false)
    }
  }, [router])

  // Close drawer on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedEmail(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Load the engagement timeline for whichever email the drawer is showing. Fetched
  // per-selection instead of with the list: most rows are never opened in the drawer,
  // and every event for every email would be a large payload for rarely-read detail.
  useEffect(() => {
    const token = selectedEmail?.tracking_token
    if (!token) {
      setEngagement([])
      return
    }

    let cancelled = false
    setEngagementLoading(true)
    setEngagement([])

    fetch(`/api/email/engagement/${token}`)
      .then(res => (res.ok ? res.json() : { events: [] }))
      .then(data => { if (!cancelled) setEngagement(data.events || []) })
      .catch(() => { if (!cancelled) setEngagement([]) })
      .finally(() => { if (!cancelled) setEngagementLoading(false) })

    // Guards against a slow response for a previously-selected email overwriting the
    // timeline after the user has already clicked a different row.
    return () => { cancelled = true }
  }, [selectedEmail?.tracking_token])

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
    } else if (tab === 'clicked') {
      data = data.filter(s => (s.click_count || 0) > 0)
    } else if (tab === 'delivered' || tab === 'bounced' || tab === 'deferred' || tab === 'spam' || tab === 'unsubscribed') {
      data = data.filter(s => s.status === tab)
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

  const totalSent      = initialSends.length
  const totalOpened    = initialSends.filter(s => {
    const t = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
    return !!t?.first_opened_at
  }).length
  const totalClicked   = initialSends.filter(s => (s.click_count || 0) > 0).length
  const totalDelivered = initialSends.filter(s => s.status === 'delivered').length
  const totalBounced   = initialSends.filter(s => s.status === 'bounced').length
  const openRate       = totalSent > 0 ? Math.round((totalOpened  / totalSent) * 100) : 0
  const clickRate      = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0

  // For the drawer — resolve tracking info of the selected email
  const selectedTracking = selectedEmail?.tracking_token
    ? initialTrackingMap[selectedEmail.tracking_token]
    : null
  const selectedOpened  = !!selectedTracking?.first_opened_at
  const selectedClicked = (selectedEmail?.click_count || 0) > 0

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">

      {/* Top bar */}
      <div className="px-6 py-4 border-b border-slate-800 flex flex-col gap-3 shrink-0">

        {/* Stats */}
        <div className="flex items-center gap-6 text-sm flex-wrap">
          <div className="flex items-center gap-2 text-slate-400">
            <Mail className="w-4 h-4 text-slate-500" />
            <span className="font-medium text-slate-200">{totalSent}</span>
            <span>Total sent</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="font-medium text-emerald-400">{totalDelivered}</span>
            <span>Delivered</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <MailCheck className="w-4 h-4 text-green-500" />
            <span className="font-medium text-green-400">{totalOpened}</span>
            <span>Opened</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <Eye className="w-4 h-4 text-orange-400" />
            <span className="font-medium text-orange-400">{openRate}%</span>
            <span>Open rate</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <MousePointerClick className="w-4 h-4 text-violet-400" />
            <span className="font-medium text-violet-400">{totalClicked}</span>
            <span>Clicked</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <MousePointerClick className="w-4 h-4 text-violet-500/60" />
            <span className="font-medium text-violet-300">{clickRate}%</span>
            <span>Click rate</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="font-medium text-red-400">{totalBounced}</span>
            <span>Bounced</span>
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
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1 overflow-x-auto max-w-full">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => router.refresh()}
            title="Refresh to get latest status"
            className="p-2 text-slate-500 hover:text-slate-300 border border-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={syncFromResend}
            disabled={syncing}
            title="Pull latest delivery status from Resend for all pending emails"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-900/20 hover:bg-sky-900/30 border border-sky-800/40 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <CloudDownload size={13} className={syncing ? 'animate-pulse' : ''} />
            {syncing ? 'Syncing…' : 'Sync from Resend'}
          </button>
          {syncMsg && (
            <span className="text-xs text-slate-400 max-w-[260px] truncate" title={syncMsg}>
              {syncMsg}
            </span>
          )}
        </div>
      </div>

      {/* Body: table + side drawer */}
      <div className="flex flex-1 overflow-hidden">

        {/* Table. min-w-0 lets this flex child shrink below the table's natural width
            instead of forcing the whole page wider (which pushed the fixed-height
            container out of the viewport and left dead space below it). */}
        <div className="flex-1 min-w-0 overflow-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
              <Mail className="w-10 h-10 opacity-20" />
              <p className="text-sm">No emails found</p>
            </div>
          ) : (
            // table-fixed so the w-[…] column widths act as proportions rather than
            // minimums. Without it the columns sum to ~1010px and, with the 480px
            // drawer and 240px sidebar alongside, overflow any screen under ~1730px —
            // which forced a horizontal scrollbar and pushed the fixed-height
            // container out of view, leaving blank space below the page.
            <table className="w-full table-fixed text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0E0B24] border-b border-slate-800">
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th scope="col" className="px-4 py-3 w-[200px]">Lead</th>
                  <th scope="col" className="px-4 py-3 w-[180px]">Subject</th>
                  <th scope="col" className="px-4 py-3 w-[90px]">Sent By</th>
                  <th scope="col" className="px-4 py-3 w-[100px]">Sent Date</th>
                  <th scope="col" className="px-4 py-3 w-[170px]">Status</th>
                  <th scope="col" className="px-4 py-3 w-[120px]">Location</th>
                  <th scope="col" className="px-4 py-3 w-[150px]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filtered.map(s => {
                  const tracking  = s.tracking_token ? initialTrackingMap[s.tracking_token] : null
                  const opened    = !!tracking?.first_opened_at
                  const clicked   = (s.click_count || 0) > 0
                  const isSelected = selectedEmail?.id === s.id
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedEmail(isSelected ? null : s)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-orange-500/10 border-l-2 border-l-orange-500'
                          : 'hover:bg-slate-800/30'
                      }`}
                    >
                      {/* Lead */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                            <User size={12} className="text-slate-500 shrink-0" />
                            <span className="truncate max-w-full">{s.lead?.name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                            <Building2 size={11} className="shrink-0" />
                            <span className="truncate max-w-full">{s.lead?.company_name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-400 text-xs">
                            <Mail size={11} className="shrink-0" />
                            <span className="truncate max-w-full">{s.to_email}</span>
                          </div>
                        </div>
                      </td>

                      {/* Subject */}
                      <td className="px-4 py-3 max-w-[180px]">
                        <span className="text-slate-300 truncate block w-full" title={s.subject}>
                          {s.subject}
                        </span>
                      </td>

                      {/* Sent by */}
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {s.sender?.full_name || '—'}
                      </td>

                      {/* Sent date + time */}
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <Calendar size={11} className="text-slate-600 shrink-0" />
                            {fmtDate(s.sent_at || s.created_at)}
                          </div>
                          <span className="text-slate-600 pl-3.5">
                            {new Date(s.sent_at || s.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <DeliveryBadge status={s.status} bounceType={s.bounce_type} />
                          {opened && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400 bg-green-900/30 border border-green-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit">
                              <MailCheck className="w-3 h-3" />
                              Opened {tracking?.opened_count ? `· ${tracking.opened_count}×` : ''}
                            </span>
                          )}
                          {tracking?.last_opened_at && (
                            <span className="text-[10px] text-slate-500" title={fmtDateTime(tracking.last_opened_at)}>
                              Last opened: {timeAgo(tracking.last_opened_at)}
                            </span>
                          )}
                          {clicked && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 bg-violet-900/30 border border-violet-800/40 px-2 py-0.5 rounded-full whitespace-nowrap w-fit"
                              title={s.last_clicked_url || undefined}
                            >
                              <MousePointerClick className="w-3 h-3" />
                              Clicked · {s.click_count}×
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Where the email was opened from. Proxied opens render as
                          "Hidden" rather than a misleading datacenter city. */}
                      <td className="px-4 py-3">
                        <OpenLocation tracking={tracking} />
                      </td>

                      {/* Actions — stop propagation so clicks don't open drawer */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setResendTarget(s)}
                            className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 bg-sky-900/20 hover:bg-sky-900/30 border border-sky-800/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                          >
                            <RotateCcw size={11} />
                            Resend
                          </button>
                          <button
                            onClick={() => setComposeLead(s)}
                            className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-900/20 hover:bg-orange-900/30 border border-orange-800/40 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors"
                          >
                            <Pen size={11} />
                            Compose
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Side drawer — email preview */}
        {selectedEmail && (
          // Caps at 480px but is allowed to shrink to 40% on narrower screens; a fixed
          // shrink-0 480px pushed the table past the viewport on laptop widths.
          <div className="w-[480px] max-w-[40%] shrink border-l border-slate-800 flex flex-col bg-[#0A0820] overflow-hidden">

            {/* Drawer header: lead info + close */}
            <div className="flex items-start justify-between px-4 py-3 border-b border-slate-800 shrink-0 gap-3">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <User size={13} className="text-slate-500 shrink-0" />
                  <span className="text-slate-200 font-semibold text-sm truncate">
                    {selectedEmail.lead?.name || selectedEmail.to_email}
                  </span>
                </div>
                {selectedEmail.lead?.company_name && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Building2 size={11} className="shrink-0" />
                    <span className="truncate">{selectedEmail.lead.company_name}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{selectedEmail.to_email}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedEmail(null)}
                className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
                title="Close (Esc)"
              >
                <X size={15} />
              </button>
            </div>

            {/* Subject + meta */}
            <div className="px-4 py-3 border-b border-slate-800 shrink-0 flex flex-col gap-2">
              <p className="text-slate-100 font-semibold text-sm leading-snug">
                {selectedEmail.subject}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                <span>From: <span className="text-slate-400">{selectedEmail.sender?.full_name || '—'}</span></span>
                <span>·</span>
                <span>{fmtDateTime(selectedEmail.sent_at || selectedEmail.created_at)}</span>
              </div>
              {/* Status badges */}
              <div className="flex flex-wrap gap-1.5">
                <DeliveryBadge status={selectedEmail.status} bounceType={selectedEmail.bounce_type} />
                {selectedOpened && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400 bg-green-900/30 border border-green-800/40 px-2 py-0.5 rounded-full whitespace-nowrap">
                    <MailCheck className="w-3 h-3" />
                    Opened {selectedTracking?.opened_count ? `· ${selectedTracking.opened_count}×` : ''}
                  </span>
                )}
                {selectedTracking?.last_opened_at && (
                  <span className="inline-flex items-center text-[11px] text-slate-500 px-2 py-0.5 whitespace-nowrap">
                    Last: {timeAgo(selectedTracking.last_opened_at)}
                  </span>
                )}
                {selectedClicked && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 bg-violet-900/30 border border-violet-800/40 px-2 py-0.5 rounded-full whitespace-nowrap"
                    title={selectedEmail.last_clicked_url || undefined}
                  >
                    <MousePointerClick className="w-3 h-3" />
                    Clicked · {selectedEmail.click_count}×
                  </span>
                )}
              </div>
            </div>

            {/* Engagement timeline — per-open/click detail the counters can't show */}
            <div className="px-4 py-3 border-b border-slate-800 shrink-0 max-h-[220px] overflow-y-auto">
              <div className="flex items-center gap-1.5 mb-2">
                <Eye size={12} className="text-slate-500" />
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Engagement Activity
                </span>
              </div>
              <EngagementTimeline events={engagement} loading={engagementLoading} />
            </div>

            {/* Email body in iframe */}
            <div className="flex-1 overflow-hidden p-2">
              <iframe
                key={selectedEmail.id}
                srcDoc={selectedEmail.html_body || '<div style="font-family:sans-serif;color:#94a3b8;padding:32px;font-size:14px">No email content stored.</div>'}
                sandbox="allow-same-origin"
                className="w-full h-full rounded-lg border border-slate-700/50 bg-white"
                title="Email preview"
              />
            </div>

            {/* Footer actions */}
            <div className="px-4 py-3 border-t border-slate-800 flex gap-2 shrink-0">
              <button
                onClick={() => { setResendTarget(selectedEmail); setSelectedEmail(null) }}
                className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 bg-sky-900/20 hover:bg-sky-900/30 border border-sky-800/40 px-3 py-2 rounded-lg whitespace-nowrap transition-colors"
              >
                <RotateCcw size={12} />
                Resend this email
              </button>
              <button
                onClick={() => { setComposeLead(selectedEmail); setSelectedEmail(null) }}
                className="flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 bg-orange-900/20 hover:bg-orange-900/30 border border-orange-800/40 px-3 py-2 rounded-lg whitespace-nowrap transition-colors"
              >
                <Pen size={12} />
                Compose new
              </button>
            </div>
          </div>
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
          onSent={() => { setComposeLead(null); router.refresh() }}
        />
      )}

      {/* Resend modal */}
      {resendTarget && (
        <ComposeModal
          leadId={resendTarget.lead_id}
          leadEmail={resendTarget.to_email}
          leadName={resendTarget.lead?.name || ''}
          businessName={resendTarget.lead?.company_name || ''}
          userId={userId}
          initialSubject={resendTarget.subject}
          initialBody={resendTarget.html_body || ''}
          onClose={() => setResendTarget(null)}
          onSent={() => { setResendTarget(null); router.refresh() }}
        />
      )}
    </div>
  )
}
