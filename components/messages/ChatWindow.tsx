'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChatContact, ChatMessage } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { Attachment, uploadChatFile, MAX_ATTACHMENT_BYTES, downloadAttachment, deleteChatMessage } from './attachments'
import { EmojiPicker } from './EmojiPicker'
import { receiptFor, ReceiptTicks } from './receipts'
import { toast } from 'sonner'
import { Send, X, Minus, Paperclip, Loader2, Download, Trash2 } from 'lucide-react'

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size'

// Time for today's messages; date + time for older ones.
function formatTime(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return time
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

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
  const [lastSeen, setLastSeen] = useState<string | null>(contact.last_seen_at ?? null)
  const [otherRead, setOtherRead] = useState<string | null>(null)
  const [otherDelivered, setOtherDelivered] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Refresh "last seen" the moment they're offline, so it isn't a stale snapshot.
  useEffect(() => {
    if (online) return
    let active = true
    supabase.from('profiles').select('last_seen_at').eq('id', contact.id).single()
      .then(({ data }) => { if (active && data) setLastSeen(data.last_seen_at) })
    return () => { active = false }
  }, [online, contact.id, supabase])

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
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!active) return
        setMessages((data as ChatMessage[]) ?? [])
        setLoading(false)
        markRead()
      })

    // The other participant's receipt timestamps (for my message ticks).
    supabase
      .from('conversation_participants')
      .select('last_read_at, delivered_at')
      .eq('conversation_id', conversationId)
      .neq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return
        setOtherRead(data.last_read_at)
        setOtherDelivered(data.delivered_at)
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
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const old = payload.old as { id: string }
        setMessages((prev) => prev.filter((m) => m.id !== old.id))
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conversation_participants',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const row = payload.new as { user_id: string; last_read_at: string | null; delivered_at: string | null }
        if (row.user_id !== userId) {
          setOtherRead(row.last_read_at)
          setOtherDelivered(row.delivered_at)
        }
      })
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  useEffect(() => {
    if (!minimized) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, minimized])

  // Insert a message row (text and/or attachment) and append it locally.
  async function insertMessage(row: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: userId, ...row })
      .select(MESSAGE_COLUMNS)
      .single()
    if (error || !data) {
      const detail = describeSupabaseError(error)
      console.error('Chat send failed:', detail, error)
      toast.error(`Send failed: ${detail}`)
      return false
    }
    const msg = data as ChatMessage
    setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
    return true
  }

  function insertEmoji(emoji: string) {
    const el = inputRef.current
    if (!el) { setInput((v) => v + emoji); return }
    const start = el.selectionStart ?? input.length
    const end = el.selectionEnd ?? input.length
    setInput(input.slice(0, start) + emoji + input.slice(end))
    setTimeout(() => {
      el.focus()
      const pos = start + emoji.length
      el.setSelectionRange(pos, pos)
    }, 0)
  }

  async function send() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setInput('')
    const ok = await insertMessage({ body })
    setSending(false)
    if (!ok) setInput(body)
    inputRef.current?.focus()
  }

  async function removeMessage(m: ChatMessage) {
    if (!window.confirm('Delete this attachment for everyone?')) return
    setMessages((prev) => prev.filter((x) => x.id !== m.id)) // optimistic
    try {
      await deleteChatMessage(supabase, m)
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error(`Delete failed: ${describeSupabaseError(err)}`)
      setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, m].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)))
    }
  }

  async function download(m: ChatMessage) {
    if (!m.attachment_path) return
    try {
      await downloadAttachment(supabase, m.attachment_path, m.attachment_name)
    } catch (err) {
      toast.error(`Download failed: ${describeSupabaseError(err)}`)
    }
  }

  // Upload each file as its own message (one attachment per row). The typed
  // caption rides along with the first one.
  async function uploadAndSend(files: File[]) {
    if (uploading || !files.length) return
    const valid = files.filter((f) => {
      if (f.size > MAX_ATTACHMENT_BYTES) { toast.error(`"${f.name || 'file'}" is too large (max 25 MB)`); return false }
      return true
    })
    if (!valid.length) return
    setUploading(true)
    const caption = input.trim()
    try {
      for (let i = 0; i < valid.length; i++) {
        const f = valid[i]
        // Pasted images often arrive nameless — give them one.
        const named = f.name ? f : new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type || 'image/png' })
        const attachment = await uploadChatFile(supabase, conversationId, named)
        await insertMessage({ body: i === 0 ? (caption || null) : null, ...attachment })
      }
      if (caption) setInput('')
    } catch (err) {
      console.error('Attachment upload failed:', err)
      toast.error(`Upload failed: ${describeSupabaseError(err)}`)
    } finally {
      setUploading(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-picking the same file(s)
    if (files.length) uploadAndSend(files)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) { e.preventDefault(); uploadAndSend(files) }
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
            {online ? 'Active now' : lastSeen ? `Last seen ${timeAgo(lastSeen)}` : 'Offline'}
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
                  <div key={m.id} className={cn('group flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
                    {m.attachment_path && (
                      <div className="max-w-[80%]">
                        <Attachment
                          path={m.attachment_path}
                          name={m.attachment_name}
                          type={m.attachment_type}
                          size={m.attachment_size}
                          mine={mine}
                        />
                      </div>
                    )}
                    {m.body && (
                      <div className={cn(
                        'max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] break-words',
                        mine ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                      )}>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-[10px] text-slate-500">{formatTime(m.created_at)}</span>
                      {mine && <ReceiptTicks status={receiptFor(m.created_at, otherRead, otherDelivered)} />}
                      {m.attachment_path && (
                        <button
                          onClick={() => download(m)}
                          aria-label="Download file"
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-200 transition-opacity"
                        >
                          <Download size={12} />
                        </button>
                      )}
                      {mine && m.attachment_path && (
                        <button
                          onClick={() => removeMessage(m)}
                          aria-label="Delete attachment"
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div className="p-2 border-t border-slate-800 shrink-0 flex items-end gap-1.5">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFile} />
            <EmojiPicker
              onPick={insertEmoji}
              size={16}
              buttonClassName="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Attach file"
              className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              onPaste={handlePaste}
              rows={1}
              placeholder={uploading ? 'Uploading…' : 'Aa'}
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
