'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatContact, ChatMessage } from '@/types'
import { cn } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { toast } from 'sonner'
import { Send, X, Minus } from 'lucide-react'

interface Props {
  userId: string
  conversationId: string
  contact: ChatContact
  online: boolean
  onClose: () => void
  className?: string
  style?: React.CSSProperties
}

export function ChatWindow({ userId, conversationId, contact, online, onClose, className, style }: Props) {
  const supabase = createClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  async function markRead() {
    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!active) return
        setMessages((data as ChatMessage[]) ?? [])
        setLoading(false)
        markRead()
      })

    const channel = supabase
      .channel(`chat-window-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const msg = payload.new as ChatMessage
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
        if (msg.sender_id !== userId) markRead()
      })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, minimized])

  async function send() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setInput('')
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: userId, body })
      .select('id, conversation_id, sender_id, body, created_at')
      .single()
    setSending(false)
    if (error || !data) {
      const detail = describeSupabaseError(error)
      console.error('Chat send failed:', detail, error)
      toast.error(`Send failed: ${detail}`)
      setInput(body)
      return
    }
    const msg = data as ChatMessage
    setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
    inputRef.current?.focus()
  }

  return (
    <div
      className={cn(
        'flex flex-col bg-[#0E0B24] border border-slate-700 rounded-t-xl shadow-2xl overflow-hidden pointer-events-auto',
        'w-[88vw] sm:w-80',
        className
      )}
      style={style}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[#160E32] cursor-pointer shrink-0"
        onClick={() => setMinimized((m) => !m)}
      >
        <div className="relative shrink-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold">
            {(contact.full_name ?? '?').charAt(0).toUpperCase()}
          </div>
          {online && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-500 ring-2 ring-[#160E32]" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-100 truncate leading-tight">{contact.full_name}</p>
          <p className={cn('text-[10px] leading-tight', online ? 'text-green-400' : 'text-slate-500')}>
            {online ? 'Active now' : 'Offline'}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m) }}
          aria-label="Minimize"
          className="p-1 text-slate-400 hover:text-white rounded"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          aria-label="Close chat"
          className="p-1 text-slate-400 hover:text-white rounded"
        >
          <X size={15} />
        </button>
      </div>

      {!minimized && (
        <>
          <div className="h-80 overflow-y-auto px-3 py-3 space-y-2 bg-[#07061A]">
            {loading ? (
              <p className="text-center text-[11px] text-slate-500 py-6">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="text-center text-[11px] text-slate-500 py-6">No messages yet. Say hello 👋</p>
            ) : (
              messages.map((m) => {
                const mine = m.sender_id === userId
                return (
                  <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] break-words',
                      mine ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                    )}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-2 border-t border-slate-800 shrink-0 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1}
              placeholder="Aa"
              className="flex-1 resize-none max-h-24 bg-slate-900 border border-slate-700 rounded-full px-3.5 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="p-2 rounded-full bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
