'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { MessageCircle, ChevronLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { SmsConversation } from './SmsConversation'
import type { SmsConversationSummary } from '@/lib/sms-conversations'

/**
 * SMS inbox: conversation list on the left, the selected lead's thread on the right
 * (reusing SmsConversation). Polls the conversation list every 15s for new replies; the
 * open thread does its own 5s polling. Collapses to a single pane on mobile.
 */
export function SmsInboxClient({
  initialConversations,
}: {
  initialConversations: SmsConversationSummary[]
}) {
  const [conversations, setConversations] = useState(initialConversations)
  const [selectedId, setSelectedId] = useState<string | null>(initialConversations[0]?.leadId ?? null)
  // Mobile only: whether the thread pane is showing (vs the list).
  const [showThread, setShowThread] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/voice/twilio/sms/conversations')
      if (!res.ok) return
      const json = await res.json()
      setConversations((json.conversations as SmsConversationSummary[]) || [])
    } catch {
      /* transient — the next tick retries */
    }
  }, [])

  useEffect(() => {
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  const selected = conversations.find((c) => c.leadId === selectedId) || null

  function openConversation(id: string) {
    setSelectedId(id)
    setShowThread(true)
  }

  return (
    <div className="p-4 md:p-6">
      <div
        className="grid overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 md:grid-cols-[340px_1fr]"
        style={{ height: 'calc(100vh - 140px)' }}
      >
        {/* List pane */}
        <div
          className={cn(
            'flex min-h-0 flex-col border-slate-800 md:border-r',
            showThread ? 'hidden md:flex' : 'flex'
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
              <MessageCircle size={15} className="text-sky-400" />
              Conversations
              <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                {conversations.length}
              </span>
            </p>
            <button
              onClick={refresh}
              aria-label="Refresh"
              className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-slate-500">
                <MessageCircle size={26} className="text-slate-700" />
                No SMS conversations yet. Text a lead from their profile to start one.
              </div>
            ) : (
              conversations.map((c) => {
                const title = c.name || c.company || c.phone || 'Lead'
                const active = c.leadId === selectedId
                return (
                  <button
                    key={c.leadId}
                    onClick={() => openConversation(c.leadId)}
                    className={cn(
                      'flex w-full items-start gap-3 border-b border-slate-800/60 px-4 py-3 text-left transition-colors',
                      active ? 'bg-orange-500/10' : 'hover:bg-slate-800/50'
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-sky-700 text-xs font-bold text-white">
                      {title.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={cn('truncate text-sm font-medium', active ? 'text-orange-300' : 'text-slate-200')}>
                          {title}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.lastAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {c.needsReply && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />}
                        <p className={cn('truncate text-xs', c.needsReply ? 'font-medium text-slate-300' : 'text-slate-500')}>
                          {c.lastDirection === 'outbound' && <span className="text-slate-600">You: </span>}
                          {c.lastBody}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Thread pane */}
        <div
          className={cn(
            'min-h-0 flex-col bg-[#0E0B24]',
            showThread ? 'flex' : 'hidden md:flex'
          )}
        >
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
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {selected.name || selected.company || selected.phone || 'Lead'}
                  </p>
                  {selected.phone && <p className="truncate text-xs text-slate-500">{selected.phone}</p>}
                </div>
                <Link
                  href={`/leads/${selected.leadId}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-slate-800"
                >
                  <ExternalLink size={12} /> Open lead
                </Link>
              </div>
              <SmsConversation
                // Remount when the selected lead changes so the thread reloads cleanly.
                key={selected.leadId}
                leadId={selected.leadId}
                phone={selected.phone}
                altPhones={selected.altPhones}
                className="min-h-0 flex-1"
              />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500">
              <MessageCircle size={28} className="text-slate-700" />
              Select a conversation to view the thread.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
