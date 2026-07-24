'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { MessageSquare, Send, Loader2, AlertCircle, Check, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime, timeAgo } from '@/lib/utils'

/** One row from GET /api/voice/twilio/sms/thread. */
export interface SmsMessage {
  id: string
  direction: 'inbound' | 'outbound'
  from_number: string
  to_number: string
  body: string | null
  num_media?: number | null
  status: string | null
  error_code: string | null
  created_at: string
}

/**
 * The SMS conversation for one lead: recipient picker, message thread, and composer.
 * Shared by the "Text" quick-modal (SmsThreadModal) and the inline SMS tab (SmsTab).
 * Loads the thread and polls every 5s so inbound replies (from the incoming webhook)
 * appear without a refresh; sends through /api/voice/twilio/sms/send.
 *
 * `className` controls the outer box height/layout — the modal passes `flex-1 min-h-0`
 * to fill the remaining panel; the tab passes a fixed height like `h-[560px]`.
 */
export function SmsConversation({
  leadId,
  phone,
  altPhones,
  className = '',
}: {
  leadId: string
  phone?: string | null
  altPhones?: { value: string; label?: string }[] | null
  className?: string
}) {
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [text, setText] = useState('')
  const [toNumber, setToNumber] = useState(() => phone || altPhones?.[0]?.value || '')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Every number on file: primary first, then alternates.
  const numbers = [
    ...(phone ? [{ value: phone, label: 'Primary' }] : []),
    ...(altPhones || []).filter((p) => p.value?.trim()),
  ]

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  const load = useCallback(
    // No setState before the first await: `loading` starts true, so the mount load never
    // needs to flip it on, and the finally (an async continuation) turns it off. Keeps
    // this callable from an effect without a synchronous state update.
    async (opts?: { silent?: boolean }) => {
      try {
        const res = await fetch(`/api/voice/twilio/sms/thread?leadId=${encodeURIComponent(leadId)}`)
        if (!res.ok) throw new Error()
        const json = await res.json()
        setMessages((prev) => {
          const next = (json.messages as SmsMessage[]) || []
          if (next.length !== prev.length) scrollToBottom()
          return next
        })
      } catch {
        if (!opts?.silent) toast.error('Could not load messages.')
      } finally {
        setLoading(false)
      }
    },
    [leadId, scrollToBottom]
  )

  useEffect(() => {
    queueMicrotask(() => load())
    const t = setInterval(() => load({ silent: true }), 5000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!loading) scrollToBottom()
  }, [loading, scrollToBottom])

  async function handleSend() {
    const body = text.trim()
    if (!body || sending) return
    if (!toNumber.trim()) {
      toast.error('No number to text.')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/voice/twilio/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, to: toNumber.trim(), body }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send')
      setText('')
      if (json.message) {
        setMessages((prev) => [...prev, json.message as SmsMessage])
        scrollToBottom()
      }
      load({ silent: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send text.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`flex flex-col overflow-hidden ${className}`}>
      {/* Recipient picker — only when there's a choice. */}
      {numbers.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-800 px-4 py-2">
          {numbers.map((n) => (
            <button
              key={n.value}
              type="button"
              onClick={() => setToNumber(n.value)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                toNumber.trim() === n.value.trim()
                  ? 'border-sky-500/60 bg-sky-500/10 text-sky-300'
                  : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {n.label ? `${n.label}: ` : ''}
              {n.value}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            <Loader2 size={14} className="mr-1.5 animate-spin" /> Loading…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-xs text-slate-500">
            <MessageSquare size={22} className="text-slate-700" />
            No messages yet. Send the first text below.
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={2}
            maxLength={1600}
            placeholder="Type a message…  (Enter to send, Shift+Enter for a new line)"
            className="min-h-[42px] flex-1 resize-none rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2
                       text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim() || !toNumber.trim()}
            aria-label="Send text"
            className="inline-flex h-[42px] items-center gap-1.5 rounded-lg bg-orange-500 px-4 text-xs font-semibold text-white
                       transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send
          </button>
        </div>
        {text.length > 480 && (
          <p className="mt-1 text-right text-[10px] text-slate-500">{text.length}/1600</p>
        )}
      </div>
    </div>
  )
}

/** Failed/undelivered outbound statuses worth flagging in red. */
const FAILED = new Set(['failed', 'undelivered'])

function Bubble({ m }: { m: SmsMessage }) {
  const outbound = m.direction === 'outbound'
  const failed = outbound && (FAILED.has(m.status || '') || !!m.error_code)

  return (
    <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%]">
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
            outbound
              ? failed
                ? 'rounded-br-sm border border-red-500/40 bg-red-500/10 text-red-200'
                : 'rounded-br-sm bg-orange-500 text-white'
              : 'rounded-bl-sm border border-slate-700 bg-slate-800 text-slate-100'
          }`}
        >
          {m.body || (m.num_media ? `[${m.num_media} attachment(s)]` : '')}
        </div>
        <div
          className={`mt-0.5 flex items-center gap-1 text-[10px] text-slate-500 ${
            outbound ? 'justify-end' : 'justify-start'
          }`}
          title={formatDateTime(m.created_at)}
        >
          <span>{timeAgo(m.created_at)}</span>
          {outbound &&
            (failed ? (
              <span className="inline-flex items-center gap-0.5 text-red-400">
                <AlertCircle size={11} /> {m.error_code ? `Failed (${m.error_code})` : 'Failed'}
              </span>
            ) : m.status === 'delivered' ? (
              <CheckCheck size={12} className="text-sky-400" />
            ) : (
              <Check size={12} />
            ))}
        </div>
      </div>
    </div>
  )
}
