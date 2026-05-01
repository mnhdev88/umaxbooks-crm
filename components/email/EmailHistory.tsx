'use client'
import { useState, useEffect } from 'react'
import { Mail, Clock, CheckCircle, XCircle, Paperclip, Send, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

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
}

export function EmailHistory({ leadId, refreshKey }: { leadId: string; refreshKey?: number }) {
  const [sends, setSends]     = useState<EmailSend[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  useEffect(() => { load() }, [leadId, refreshKey])

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/email/history?lead_id=${leadId}`)
    const { sends } = await res.json()
    setSends(sends || [])
    setLoading(false)
  }

  async function sendNow(id: string) {
    setSending(id)
    const res = await fetch('/api/email/history', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSending(null)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading history…
      </div>
    )
  }

  if (sends.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 text-sm">
        <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
        No emails sent yet for this lead
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sends.map(s => (
        <div key={s.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
          <div
            className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
            onClick={() => setExpanded(expanded === s.id ? null : s.id)}
          >
            <div className={`mt-0.5 shrink-0 ${s.status === 'sent' ? 'text-green-400' : s.status === 'scheduled' ? 'text-blue-400' : 'text-red-400'}`}>
              {s.status === 'sent' ? <CheckCircle className="w-4 h-4" /> : s.status === 'scheduled' ? <Clock className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
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
      ))}
    </div>
  )
}
