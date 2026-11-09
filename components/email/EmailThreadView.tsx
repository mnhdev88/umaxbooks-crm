'use client'

import { useEffect, useState, useCallback } from 'react'
import { Reply, Send, Mail, ChevronDown, ChevronUp, Paperclip, Loader2, MailCheck, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ThreadEmail {
  id: string
  direction: 'outbound' | 'inbound'
  source: 'crm' | 'gmail'
  status: string
  from_email: string | null
  to_email: string | null
  cc: string | null
  subject: string | null
  html_body: string | null
  attachments: { name: string }[] | null
  sent_at: string | null
  created_at: string
  error: string | null
  tracking_token: string | null
  sender: { full_name: string } | null
  mailbox: { full_name: string; email: string } | null
}

/** Display name from a header like `"Jane Doe" <jane@x.com>`. */
function displayName(addr: string | null) {
  if (!addr) return ''
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</)
  return m ? m[1].trim() : addr.replace(/[<>]/g, '').trim()
}

const stripPixel = (html: string) => html.replace(/<img[^>]+\/api\/track\/open\/[^"'>]+[^>]*>/gi, '')

/**
 * Full email conversation with one lead, oldest → newest. The newest message and any
 * lead replies start expanded; bodies render in a sandboxed iframe (no scripts).
 */
export function EmailThreadView({ leadId, reloadKey }: { leadId: string; reloadKey: number }) {
  const [emails, setEmails] = useState<ThreadEmail[] | null>(null)
  const [opens, setOpens] = useState<Record<string, { first_opened_at: string | null; opened_count: number }>>({})
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/email/thread?lead_id=${leadId}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Failed to load'); return }
      const list = (json.emails || []) as ThreadEmail[]
      setEmails(list)
      setOpens(json.opens || {})
      setError(null)
      const last = list[list.length - 1]
      setExpanded(new Set([...(last ? [last.id] : []), ...list.slice(-3).filter(e => e.direction === 'inbound').map(e => e.id)]))
    } catch {
      setError('Failed to load')
    }
  }, [leadId])

  useEffect(() => { load() }, [load, reloadKey])

  if (error) return <div className="p-6 text-sm text-red-400">{error}</div>
  if (!emails) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 size={16} className="animate-spin" /> Loading conversation…
      </div>
    )
  }
  if (!emails.length) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-500">No emails in this conversation.</div>
  }

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 md:p-4">
      {emails.map(e => {
        const inbound = e.direction === 'inbound'
        const open = expanded.has(e.id)
        const failed = ['failed', 'bounced', 'spam'].includes(e.status)
        const tracked = e.tracking_token ? opens[e.tracking_token] : null
        const who = inbound
          ? displayName(e.from_email)
          : e.sender?.full_name || e.mailbox?.full_name || displayName(e.from_email)
        const when = new Date(e.sent_at || e.created_at)
        return (
          <div
            key={e.id}
            className={cn(
              'overflow-hidden rounded-xl border',
              inbound ? 'border-sky-500/25 bg-sky-500/[0.04]' : 'border-white/10 bg-white/[0.03]',
              inbound ? 'md:mr-10' : 'md:ml-10',
            )}
          >
            <button
              onClick={() => toggle(e.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
            >
              <div className={cn('mt-0.5 shrink-0', inbound ? 'text-sky-400' : failed ? 'text-red-400' : 'text-green-400')}>
                {inbound ? <Reply size={15} /> : failed ? <XCircle size={15} /> : <Send size={15} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-100">{who || (inbound ? 'Lead' : 'Agent')}</p>
                  <span className="shrink-0 text-[11px] text-slate-500" title={when.toLocaleString()}>
                    {when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    inbound ? 'border-sky-500/20 bg-sky-500/10 text-sky-300' : 'border-white/10 bg-white/5 text-slate-400',
                  )}>
                    {inbound ? 'Reply from lead' : e.source === 'gmail' ? 'via Gmail' : 'via CRM'}
                  </span>
                  {failed && <span className="text-[10px] font-semibold uppercase text-red-400">{e.status}</span>}
                  {tracked?.first_opened_at && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
                      <MailCheck size={11} /> Opened{tracked.opened_count > 1 ? ` ${tracked.opened_count}×` : ''}
                    </span>
                  )}
                  <p className="min-w-0 truncate text-xs text-slate-400">{e.subject || '(no subject)'}</p>
                </div>
                {open && (
                  <p className="mt-1 break-words text-[11px] text-slate-500">
                    From: {e.from_email} · To: {e.to_email}{e.cc ? ` · CC: ${e.cc}` : ''}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-slate-500">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
            </button>

            {open && (
              <div className="border-t border-white/10">
                {e.html_body ? (
                  <iframe
                    title={e.subject || 'Email'}
                    srcDoc={stripPixel(e.html_body)}
                    sandbox="allow-same-origin allow-popups"
                    className="block min-h-[160px] w-full border-0 bg-white"
                    onLoad={ev => {
                      const doc = ev.currentTarget.contentDocument
                      if (!doc) return
                      // Open links in a new tab instead of inside the frame
                      doc.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
                      ev.currentTarget.style.height = `${Math.min(doc.documentElement.scrollHeight + 8, 1400)}px`
                    }}
                  />
                ) : (
                  <p className="px-4 py-3 text-xs text-slate-500">(no content)</p>
                )}
                {!!e.attachments?.length && (
                  <p className="flex items-center gap-1 border-t border-white/10 px-4 py-2 text-xs text-slate-400">
                    <Paperclip size={12} /> {e.attachments.map(a => a.name).join(', ')}
                  </p>
                )}
                {e.error && <p className="border-t border-white/10 px-4 py-2 text-xs text-red-400">{e.error}</p>}
              </div>
            )}
          </div>
        )
      })}
      <p className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-slate-600">
        <Mail size={11} /> Emails sent directly from Gmail sync every 5 minutes
      </p>
    </div>
  )
}
