'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Inbox, ChevronLeft, ExternalLink, RefreshCw, Reply, Search, Loader2, Plus } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { usePoll } from '@/lib/use-poll'
import type { EmailConversationSummary } from '@/lib/email-conversations'
import { EmailThreadView } from './EmailThreadView'
import { ComposeModal } from './ComposeModal'
import { EMAIL_UNREAD_EVENT } from '@/lib/email-events'
import { NewEmailDialog, type RecipientLead } from './NewEmailDialog'

type Filter = 'all' | 'unread' | 'needs_reply'

/** What the compose window is open for — a reply in a thread, or a new email. */
interface ComposeTarget {
  leadId: string
  toEmail: string
  altEmails: { value: string; label?: string }[] | null
  name: string
  company: string
  subject: string
}

/**
 * Emails inbox: every lead email conversation (CRM sends, mail synced from Gmail and lead
 * replies), one row per lead, with the thread beside it. Mirrors the SMS inbox layout.
 */
export function EmailInboxClient({
  initialConversations,
  userId,
  agents,
}: {
  initialConversations: EmailConversationSummary[]
  userId: string
  /** Agent filter options — only passed to admins / sales managers. */
  agents: { id: string; full_name: string }[]
}) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showThread, setShowThread] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [compose, setCompose] = useState<ComposeTarget | null>(null)
  const [newEmailOpen, setNewEmailOpen] = useState(false)
  // Floating "New email" button: shrinks to a + while the list scrolls, grows back once it settles
  const [scrolling, setScrolling] = useState(false)
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onListScroll = useCallback(() => {
    setScrolling(true)
    if (scrollIdle.current) clearTimeout(scrollIdle.current)
    scrollIdle.current = setTimeout(() => setScrolling(false), 450)
  }, [])
  useEffect(() => () => { if (scrollIdle.current) clearTimeout(scrollIdle.current) }, [])
  const [threadKey, setThreadKey] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/email/conversations')
      if (!res.ok) return
      const json = await res.json()
      setConversations((json.conversations as EmailConversationSummary[]) || [])
    } catch { /* transient — next tick retries */ }
  }, [])

  // New mail arrives via the 5-min Gmail sync, so a 60s poll is plenty
  usePoll(refresh, 60_000)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return conversations.filter(c => {
      if (filter === 'unread' && !c.unread) return false
      if (filter === 'needs_reply' && !c.needsReply) return false
      if (agentId && c.assignedAgentId !== agentId && !c.agentIds.includes(agentId)) return false
      if (q && ![c.name, c.company, c.email, c.lastSubject].some(v => v?.toLowerCase().includes(q))) return false
      return true
    })
  }, [conversations, filter, search, agentId])

  const unreadTotal = conversations.filter(c => c.unread).length
  const selected = conversations.find(c => c.leadId === selectedId) || null

  async function openConversation(id: string) {
    setSelectedId(id)
    setShowThread(true)
    const c = conversations.find(x => x.leadId === id)
    if (c?.unread) {
      setConversations(prev => prev.map(x => (x.leadId === id ? { ...x, unread: false } : x)))
      await fetch('/api/email/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: id }),
      }).catch(() => {})
      window.dispatchEvent(new Event(EMAIL_UNREAD_EVENT))
    }
  }

  async function syncNow() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/cron/gmail-sync', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) setSyncMsg(json.error || json.failed?.[0]?.error || 'Sync failed')
      else setSyncMsg(json.imported ? `${json.imported} new email${json.imported === 1 ? '' : 's'}` : 'Up to date')
      await refresh()
      setThreadKey(k => k + 1)
      window.dispatchEvent(new Event(EMAIL_UNREAD_EVENT))
    } finally {
      setSyncing(false)
    }
  }

  // Same subject (ignoring Re:) → the send continues the existing Gmail thread
  const replySubject = !selected || selected.lastSubject === '(no subject)'
    ? ''
    : /^re:/i.test(selected.lastSubject) ? selected.lastSubject : `Re: ${selected.lastSubject}`

  const FILTERS: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread', count: unreadTotal },
    { id: 'needs_reply', label: 'Needs reply' },
  ]

  return (
    <div className="p-4 md:p-6">
      <div
        className="grid overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 md:grid-cols-[360px_1fr]"
        style={{ height: 'calc(100vh - 140px)' }}
      >
        {/* List pane */}
        <div className={cn('relative flex min-h-0 flex-col border-slate-800 md:border-r', showThread ? 'hidden md:flex' : 'flex')}>
          <div className="space-y-2.5 border-b border-slate-800 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                <Inbox size={15} className="text-sky-400" />
                Conversations
                <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                  {visible.length}
                </span>
              </p>
              <div className="flex items-center gap-1.5">
              <button
                onClick={syncNow}
                disabled={syncing}
                title="Pull new mail from Gmail now"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                <span className="hidden sm:inline">Sync now</span>
              </button>
              </div>
            </div>
            {syncMsg && <p className="text-[11px] text-slate-400">{syncMsg}</p>}

            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search lead, email or subject"
                className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-orange-500/50 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    filter === f.id ? 'bg-orange-500/15 text-orange-300' : 'text-slate-400 hover:bg-slate-800',
                  )}
                >
                  {f.label}
                  {!!f.count && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-[10px] text-white">{f.count}</span>}
                </button>
              ))}
              {agents.length > 0 && (
                <select
                  value={agentId}
                  onChange={e => setAgentId(e.target.value)}
                  aria-label="Filter by agent"
                  className="ml-auto max-w-[120px] rounded-lg border border-white/10 bg-surface px-2 py-1 text-[11px] text-slate-300 focus:outline-none"
                >
                  <option value="">All agents</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                </select>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-20" onScroll={onListScroll}>
            {visible.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-slate-500">
                <Inbox size={26} className="text-slate-700" />
                {conversations.length === 0
                  ? 'No lead emails yet. Emails sent from the CRM or Gmail to a lead show up here.'
                  : 'No conversations match these filters.'}
              </div>
            ) : (
              visible.map(c => {
                const title = c.company || c.name || c.email || 'Lead'
                const active = c.leadId === selectedId
                return (
                  <button
                    key={c.leadId}
                    onClick={() => openConversation(c.leadId)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition-colors',
                      active ? 'bg-orange-500/10' : 'hover:bg-slate-800/50',
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-sky-700 text-xs font-bold text-white">
                      {title.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn(
                          'truncate text-sm',
                          c.unread ? 'font-semibold text-white' : 'font-medium',
                          active ? 'text-orange-300' : !c.unread && 'text-slate-200',
                        )}>
                          {title}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.lastAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {c.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" aria-label="Unread reply" />}
                        <p className={cn('truncate text-xs', c.unread ? 'font-medium text-slate-200' : 'text-slate-500')}>
                          {c.lastDirection === 'inbound'
                            ? <span className="text-sky-400">Reply: </span>
                            : <span className="text-slate-600">{c.lastSource === 'gmail' ? 'Gmail: ' : 'CRM: '}</span>}
                          {c.lastSubject}
                        </p>
                      </div>
                      {c.name && c.company && <p className="mt-0.5 truncate text-[11px] text-slate-600">{c.name} · {c.messageCount} email{c.messageCount === 1 ? '' : 's'}</p>}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* Floating "New email": a full pill at rest, a compact + while the list scrolls */}
          <button
            onClick={() => setNewEmailOpen(true)}
            aria-label="New email"
            title="New email"
            className={cn(
              'absolute bottom-4 right-4 z-10 flex h-12 items-center justify-center rounded-full bg-orange-500 text-white',
              'shadow-lg shadow-orange-950/40 ring-1 ring-white/10 hover:bg-orange-600 active:scale-95',
              'transition-[width,transform,background-color] duration-200 ease-out motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300',
              scrolling ? 'w-12 scale-90' : 'w-[9.5rem] scale-100',
            )}
          >
            <Plus size={20} strokeWidth={2.5} className="shrink-0" aria-hidden="true" />
            <span
              className={cn(
                'overflow-hidden whitespace-nowrap text-sm font-semibold transition-[max-width,opacity,margin] duration-200 ease-out motion-reduce:transition-none',
                scrolling ? 'ml-0 max-w-0 opacity-0' : 'ml-1.5 max-w-[6.5rem] opacity-100',
              )}
            >
              New email
            </span>
          </button>
        </div>

        {/* Thread pane */}
        <div className={cn('min-h-0 flex-col bg-surface', showThread ? 'flex' : 'hidden md:flex')}>
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                <button
                  onClick={() => setShowThread(false)}
                  aria-label="Back to list"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:hidden"
                >
                  <ChevronLeft size={18} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-100">{selected.company || selected.name || 'Lead'}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[selected.name, selected.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button
                  onClick={() => selected && setCompose({
                    leadId: selected.leadId,
                    toEmail: selected.email || selected.altEmails?.[0]?.value || '',
                    altEmails: selected.altEmails,
                    name: selected.name || '',
                    company: selected.company || '',
                    subject: replySubject,
                  })}
                  disabled={!selected.email && !selected.altEmails?.length}
                  className="inline-flex items-center gap-1 rounded-lg bg-orange-500 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-40"
                >
                  <Reply size={12} /> Reply
                </button>
                <Link
                  href={`/leads/${selected.leadId}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800"
                >
                  <ExternalLink size={12} /> <span className="hidden sm:inline">Open lead</span>
                </Link>
              </div>
              <EmailThreadView key={selected.leadId} leadId={selected.leadId} reloadKey={threadKey} />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <Inbox size={28} className="text-slate-700" />
              Select a conversation to read it.
            </div>
          )}
        </div>
      </div>

      {newEmailOpen && (
        <NewEmailDialog
          onClose={() => setNewEmailOpen(false)}
          onReady={(lead: RecipientLead, toEmail: string) => {
            setNewEmailOpen(false)
            setCompose({
              leadId: lead.id,
              toEmail,
              altEmails: lead.alt_emails,
              name: lead.name || '',
              company: lead.company_name || '',
              subject: '',
            })
          }}
        />
      )}

      {compose && (
        <ComposeModal
          leadId={compose.leadId}
          leadEmail={compose.toEmail}
          altEmails={compose.altEmails}
          leadName={compose.name}
          businessName={compose.company}
          userId={userId}
          initialSubject={compose.subject}
          initialBody="<p><br></p>"
          onClose={() => setCompose(null)}
          onSent={async () => {
            const sentTo = compose.leadId
            setThreadKey(k => k + 1)
            await refresh()
            // Show the conversation that was just written to
            setSelectedId(sentTo)
            setShowThread(true)
          }}
        />
      )}
    </div>
  )
}
