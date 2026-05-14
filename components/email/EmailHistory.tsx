'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Mail, Clock, CheckCircle, XCircle, Paperclip, Send,
  ChevronDown, ChevronUp, Loader2, FileEdit, Trash2,
  MailOpen, MailCheck,
} from 'lucide-react'

interface EmailSend {
  id: string
  from_email: string
  to_email: string
  cc: string | null
  bcc: string | null
  subject: string
  html_body: string | null
  attachments: { name: string; url: string }[]
  status: 'sent' | 'scheduled' | 'failed'
  scheduled_at: string | null
  sent_at: string | null
  error: string | null
  created_at: string
  sender: { full_name: string } | null
  tracking_token: string | null
}

interface TrackingRow {
  token: string
  first_opened_at: string | null
  last_opened_at: string | null
  opened_count: number
}

export interface EmailDraft {
  provider_id?: string
  to_email?: string
  cc?: string
  bcc?: string
  subject?: string
  html_body?: string
  attachments?: { name: string; url: string }[]
  updated_at?: string
}

interface Props {
  leadId: string
  refreshKey?: number
  onOpenDraft?: (draft: EmailDraft) => void
}

export function EmailHistory({ leadId, refreshKey, onOpenDraft }: Props) {
  const supabase = createClient()
  const [sends, setSends]           = useState<EmailSend[]>([])
  const [draft, setDraft]           = useState<EmailDraft | null>(null)
  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingRow>>({})
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [sending, setSending]       = useState<string | null>(null)
  const [deletingDraft, setDeletingDraft] = useState(false)

  useEffect(() => { load() }, [leadId, refreshKey])

  async function load() {
    setLoading(true)
    const [histRes, draftRes] = await Promise.all([
      fetch(`/api/email/history?lead_id=${leadId}`),
      fetch(`/api/email/draft?lead_id=${leadId}`),
    ])
    const { sends: rawSends } = await histRes.json()
    const { draft } = await draftRes.json()
    const loadedSends: EmailSend[] = rawSends || []
    setSends(loadedSends)
    setDraft(draft || null)

    // Fetch tracking data for all sends that have a tracking_token
    const tokens = loadedSends
      .map(s => s.tracking_token)
      .filter((t): t is string => !!t)

    if (tokens.length > 0) {
      const { data: trackingRows } = await supabase
        .from('email_tracking')
        .select('token, first_opened_at, last_opened_at, opened_count')
        .in('token', tokens)
      if (trackingRows) {
        const map: Record<string, TrackingRow> = {}
        for (const row of trackingRows as TrackingRow[]) {
          map[row.token] = row
        }
        setTrackingMap(map)
      }
    }

    setLoading(false)
  }

  async function sendNow(id: string) {
    setSending(id)
    await fetch('/api/email/history', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSending(null)
    load()
  }

  async function discardDraft() {
    setDeletingDraft(true)
    await fetch(`/api/email/draft?lead_id=${leadId}`, { method: 'DELETE' })
    setDraft(null)
    setDeletingDraft(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
      </div>
    )
  }

  const isEmpty = !draft && sends.length === 0

  if (isEmpty) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
        No emails sent yet for this lead
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Drafts section */}
      {draft && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Drafts</p>
          <div
            className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl overflow-hidden cursor-pointer hover:bg-yellow-500/10 transition-colors"
            onClick={() => onOpenDraft?.(draft)}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <FileEdit className="w-4 h-4 mt-0.5 shrink-0 text-yellow-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded">DRAFT</span>
                  <p className="text-white text-sm font-medium truncate">{draft.subject || '(No subject)'}</p>
                </div>
                <p className="text-xs text-slate-400">
                  {draft.to_email ? `To: ${draft.to_email}` : 'No recipient'}
                  {draft.updated_at ? ` · Saved ${new Date(draft.updated_at).toLocaleDateString()}` : ''}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); discardDraft() }}
                disabled={deletingDraft}
                className="shrink-0 text-slate-500 hover:text-red-400 transition-colors p-1 rounded"
                title="Discard draft"
              >
                {deletingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sent emails section */}
      {sends.length > 0 && (
        <div>
          {draft && <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Sent</p>}
          <div className="space-y-2">
            {sends.map(s => {
              const tracking = s.tracking_token ? trackingMap[s.tracking_token] : null
              const opened = !!tracking?.first_opened_at

              return (
                <div key={s.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  <div
                    className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                  >
                    {/* Sent/scheduled/failed icon */}
                    <div className={`mt-0.5 shrink-0 ${s.status === 'sent' ? 'text-green-400' : s.status === 'scheduled' ? 'text-blue-400' : 'text-red-400'}`}>
                      {s.status === 'sent'
                        ? <CheckCircle className="w-4 h-4" />
                        : s.status === 'scheduled'
                          ? <Clock className="w-4 h-4" />
                          : <XCircle className="w-4 h-4" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-white text-sm font-medium truncate">{s.subject}</p>
                        <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">
                          {s.status === 'scheduled' && s.scheduled_at
                            ? `Scheduled ${new Date(s.scheduled_at).toLocaleDateString()}`
                            : s.sent_at ? new Date(s.sent_at).toLocaleDateString() : new Date(s.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <p className="text-xs text-slate-400 mt-0.5">
                        To: {s.to_email}
                        {s.cc ? ` · CC: ${s.cc}` : ''}
                        {s.sender ? ` · Sent by ${s.sender.full_name}` : ''}
                      </p>

                      {/* Open tracking badge */}
                      {s.status === 'sent' && s.tracking_token && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {opened ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400 bg-green-900/30 border border-green-800/40 px-2 py-0.5 rounded-full">
                              <MailCheck className="w-3 h-3" />
                              Opened · {new Date(tracking!.first_opened_at!).toLocaleString()}
                              {tracking!.opened_count > 1 && ` · ${tracking!.opened_count}×`}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-2 py-0.5 rounded-full">
                              <MailOpen className="w-3 h-3" />
                              Not opened yet
                            </span>
                          )}
                        </div>
                      )}

                      {s.attachments?.length > 0 && (
                        <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                          <Paperclip className="w-3 h-3" />
                          {s.attachments.map(a => a.name).join(', ')}
                        </p>
                      )}
                      {s.status === 'failed' && s.error && (
                        <p className="text-xs text-red-400 mt-1">{s.error}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {s.status === 'scheduled' && (
                        <button
                          onClick={e => { e.stopPropagation(); sendNow(s.id) }}
                          disabled={sending === s.id}
                          className="flex items-center gap-1 text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {sending === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          Send Now
                        </button>
                      )}
                      {expanded === s.id ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </div>
                  </div>

                  {expanded === s.id && s.html_body && (
                    <div className="border-t border-white/10">
                      <iframe
                        srcDoc={s.html_body}
                        className="w-full min-h-[300px] border-0 bg-white"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
