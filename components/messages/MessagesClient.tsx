'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useOnlineUsers } from '@/components/layout/presence'
import { ChatContact, ChatConversation, ChatMessage } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { Attachment, uploadChatFile, MAX_ATTACHMENT_BYTES, downloadAttachment, deleteChatMessage } from './attachments'
import { EmojiPicker } from './EmojiPicker'
import { receiptFor, ReceiptTicks } from './receipts'
import { toast } from 'sonner'
import { Send, Plus, ArrowLeft, Search, MessageSquare, X, Paperclip, Loader2, Download, Trash2 } from 'lucide-react'

const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size'

// Preview text for the conversation list: body, else "📎 <filename>".
function messagePreview(m: { body?: string | null; attachment_name?: string | null; attachment_path?: string | null }): string | null {
  if (m.body) return m.body
  if (m.attachment_path) return `📎 ${m.attachment_name ?? 'Attachment'}`
  return null
}

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-orange-500/20 text-orange-400',
  agent:       'bg-blue-500/20 text-blue-400',
  sales_agent: 'bg-purple-500/20 text-purple-400',
  developer:   'bg-cyan-500/20 text-cyan-400',
}

function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white font-bold"
        style={{ fontSize: size * 0.4 }}
      >
        {(name ?? '?').charAt(0).toUpperCase()}
      </div>
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full bg-green-500 ring-2 ring-[#0E0B24]"
          style={{ width: size * 0.3, height: size * 0.3 }}
          aria-label="Online"
        />
      )}
    </div>
  )
}

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface Props {
  userId: string
  contacts: ChatContact[]
  initialConversations: ChatConversation[]
}

export function MessagesClient({ userId, contacts, initialConversations }: Props) {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const onlineUsers = useOnlineUsers()

  const [conversations, setConversations] = useState<ChatConversation[]>(initialConversations)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [activeLastSeen, setActiveLastSeen] = useState<string | null>(null)
  const [otherRead, setOtherRead] = useState<string | null>(null)
  const [otherDelivered, setOtherDelivered] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactSearch, setContactSearch] = useState('')

  const activeIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  activeIdRef.current = activeId

  const activeConv = conversations.find((c) => c.id === activeId) ?? null
  const isOnline = !!activeConv?.other && onlineUsers.has(activeConv.other.id)

  // ── Fetch one conversation's metadata (for threads not yet in the list) ────
  const fetchConversationMeta = useCallback(async (convId: string): Promise<ChatConversation | null> => {
    const [{ data: conv }, { data: members }, { data: last }] = await Promise.all([
      supabase.from('conversations').select('id, is_group, title, last_message_at, created_at').eq('id', convId).single(),
      supabase.from('conversation_participants').select('user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)').eq('conversation_id', convId),
      supabase.from('messages').select('body, created_at, sender_id, attachment_name, attachment_path').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(1),
    ])
    if (!conv) return null
    const otherRow = (members ?? []).find((m) => m.user_id !== userId)
    const lastMsg = last?.[0]
    return {
      id: conv.id,
      is_group: conv.is_group,
      title: conv.title,
      last_message_at: conv.last_message_at,
      created_at: conv.created_at,
      other: (otherRow?.profile as unknown as ChatContact) ?? null,
      last_message: lastMsg ? messagePreview(lastMsg) : null,
      unread: false,
    }
  }, [supabase, userId])

  // ── Load a thread + mark it read ───────────────────────────────────────────
  const openConversation = useCallback(async (convId: string) => {
    setActiveId(convId)
    setLoadingThread(true)
    setOtherRead(null)
    setOtherDelivered(null)
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(500)
    setMessages((data as ChatMessage[]) ?? [])
    setLoadingThread(false)

    // Other participant's receipt timestamps (for my message ticks).
    supabase
      .from('conversation_participants')
      .select('last_read_at, delivered_at')
      .eq('conversation_id', convId)
      .neq('user_id', userId)
      .maybeSingle()
      .then(({ data: p }) => { if (p) { setOtherRead(p.last_read_at); setOtherDelivered(p.delivered_at) } })

    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('user_id', userId)
    setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, unread: false } : c))
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [supabase, userId])

  // ── Realtime: any new message I'm allowed to see (RLS-filtered stream) ─────
  useEffect(() => {
    const channel = supabase
      .channel('chat-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as ChatMessage

        // Append to the open thread (dedupe — our own sends are added optimistically).
        if (msg.conversation_id === activeIdRef.current) {
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
          if (msg.sender_id !== userId) {
            await supabase
              .from('conversation_participants')
              .update({ last_read_at: new Date().toISOString() })
              .eq('conversation_id', msg.conversation_id)
              .eq('user_id', userId)
          }
        }

        // Update / insert the conversation in the list.
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === msg.conversation_id)
          if (!existing) {
            // New thread someone started with me — fetch its metadata, then prepend.
            fetchConversationMeta(msg.conversation_id).then((meta) => {
              if (!meta) return
              setConversations((cur) =>
                cur.some((c) => c.id === meta.id)
                  ? cur
                  : [{ ...meta, unread: msg.sender_id !== userId }, ...cur]
              )
            })
            return prev
          }
          const updated: ChatConversation = {
            ...existing,
            last_message: messagePreview(msg),
            last_message_at: msg.created_at,
            unread: msg.sender_id !== userId && msg.conversation_id !== activeIdRef.current,
          }
          return [updated, ...prev.filter((c) => c.id !== msg.conversation_id)]
        })
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        const old = payload.old as { id: string; conversation_id?: string }
        if (old.conversation_id === activeIdRef.current || !old.conversation_id) {
          setMessages((prev) => prev.filter((m) => m.id !== old.id))
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants' }, (payload) => {
        const row = payload.new as { conversation_id: string; user_id: string; last_read_at: string | null; delivered_at: string | null }
        if (row.conversation_id === activeIdRef.current && row.user_id !== userId) {
          setOtherRead(row.last_read_at)
          setOtherDelivered(row.delivered_at)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, userId, fetchConversationMeta])

  // ── Deep link: /messages?c=<id> opens that thread ─────────────────────────
  useEffect(() => {
    const c = searchParams.get('c')
    if (c) openConversation(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Refresh "last seen" for the open thread's other user when they're offline.
  useEffect(() => {
    const other = activeConv?.other
    if (!other) { setActiveLastSeen(null); return }
    if (isOnline) return
    setActiveLastSeen(other.last_seen_at ?? null)
    let active = true
    supabase.from('profiles').select('last_seen_at').eq('id', other.id).single()
      .then(({ data }) => { if (active && data) setActiveLastSeen(data.last_seen_at) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, isOnline])

  // ── Start (or open existing) DM with a contact ─────────────────────────────
  async function startConversation(contact: ChatContact) {
    setPickerOpen(false)
    setContactSearch('')
    const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: contact.id })
    if (error || !convId) {
      toast.error('Could not start conversation')
      return
    }
    if (!conversations.some((c) => c.id === convId)) {
      const meta = await fetchConversationMeta(convId)
      if (meta) setConversations((prev) => [meta, ...prev])
    }
    openConversation(convId as string)
  }

  // ── Send a message (text and/or attachment) ───────────────────────────────
  async function insertMessage(convId: string, row: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: convId, sender_id: userId, ...row })
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
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === convId)
      if (!existing) return prev
      return [{ ...existing, last_message: messagePreview(msg), last_message_at: msg.created_at, unread: false },
              ...prev.filter((c) => c.id !== convId)]
    })
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
    if (!body || !activeId || sending) return
    setSending(true)
    setInput('')
    const ok = await insertMessage(activeId, { body })
    setSending(false)
    if (!ok) setInput(body)
    inputRef.current?.focus()
  }

  // Upload each file as its own message; the typed caption rides with the first.
  async function uploadAndSend(files: File[]) {
    if (!activeId || uploading || !files.length) return
    const convId = activeId
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
        const attachment = await uploadChatFile(supabase, convId, named)
        await insertMessage(convId, { body: i === 0 ? (caption || null) : null, ...attachment })
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
    e.target.value = ''
    if (files.length) uploadAndSend(files)
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f)
    if (files.length) { e.preventDefault(); uploadAndSend(files) }
  }

  async function removeMessage(m: ChatMessage) {
    if (!window.confirm('Delete this attachment for everyone?')) return
    setMessages((prev) => prev.filter((x) => x.id !== m.id))
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

  const filteredContacts = contacts
    .filter((c) => c.full_name.toLowerCase().includes(contactSearch.toLowerCase()))
    .sort((a, b) => Number(onlineUsers.has(b.id)) - Number(onlineUsers.has(a.id)))

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">

      {/* ── Conversation list ─────────────────────────────────────────────── */}
      <aside className={cn(
        'w-full md:w-80 md:shrink-0 border-r border-slate-800 flex flex-col bg-[#0E0B24]',
        activeId ? 'hidden md:flex' : 'flex'
      )}>
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">Conversations</span>
          <button
            onClick={() => setPickerOpen(true)}
            aria-label="New message"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-16 text-slate-500">
              <MessageSquare size={28} className="mb-2 opacity-50" />
              <p className="text-sm">No conversations yet.</p>
              <button onClick={() => setPickerOpen(true)} className="mt-3 text-xs text-orange-400 hover:text-orange-300">
                Start a chat
              </button>
            </div>
          ) : (
            <ul className="list-none m-0 p-0 divide-y divide-slate-800/70">
              {conversations.map((c) => {
                const name = c.is_group ? (c.title ?? 'Group') : (c.other?.full_name ?? 'Unknown')
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => openConversation(c.id)}
                      className={cn(
                        'w-full text-left px-4 py-3 flex items-center gap-3 transition-colors',
                        c.id === activeId ? 'bg-orange-500/10' : 'hover:bg-slate-800/60'
                      )}
                    >
                      <Avatar name={name} online={!!c.other && onlineUsers.has(c.other.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('text-sm truncate', c.unread ? 'font-semibold text-white' : 'font-medium text-slate-200')}>
                            {name}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0">{timeAgo(c.last_message_at)}</span>
                        </div>
                        <p className={cn('text-xs truncate mt-0.5', c.unread ? 'text-slate-300' : 'text-slate-500')}>
                          {c.last_message ?? 'No messages yet'}
                        </p>
                      </div>
                      {c.unread && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" aria-label="Unread" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Active thread ─────────────────────────────────────────────────── */}
      <section className={cn('flex-1 flex-col min-w-0 bg-[#07061A]', activeId ? 'flex' : 'hidden md:flex')}>
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <MessageSquare size={40} className="mb-3 opacity-40" />
            <p className="text-sm">Select a conversation to start chatting.</p>
          </div>
        ) : (
          <>
            <div className="h-14 border-b border-slate-800 flex items-center gap-3 px-4 shrink-0 bg-[#160E32]/60">
              <button
                onClick={() => setActiveId(null)}
                aria-label="Back to conversations"
                className="md:hidden p-1.5 -ml-1.5 text-slate-400 hover:text-white rounded"
              >
                <ArrowLeft size={18} />
              </button>
              <Avatar
                name={activeConv.is_group ? (activeConv.title ?? 'Group') : (activeConv.other?.full_name ?? '?')}
                size={32}
                online={!!activeConv.other && onlineUsers.has(activeConv.other.id)}
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
                  {activeConv.is_group ? (activeConv.title ?? 'Group') : (activeConv.other?.full_name ?? 'Unknown')}
                </p>
                {activeConv.other && (
                  isOnline
                    ? <span className="text-[11px] text-green-400 flex items-center gap-1 leading-tight">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />Active now
                      </span>
                    : <span className="text-[11px] text-slate-500 leading-tight">
                        {activeLastSeen ? `Last seen ${timeAgo(activeLastSeen)}` : formatRole(activeConv.other.role)}
                      </span>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
              {loadingThread ? (
                <p className="text-center text-xs text-slate-500 py-8">Loading…</p>
              ) : messages.length === 0 ? (
                <p className="text-center text-xs text-slate-500 py-8">No messages yet. Say hello 👋</p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === userId
                  return (
                    <div key={m.id} className={cn('group flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
                      {m.attachment_path && (
                        <div className="max-w-[75%]">
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
                          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm break-words',
                          mine ? 'bg-orange-500 text-white rounded-br-sm' : 'bg-slate-800 text-slate-100 rounded-bl-sm'
                        )}>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 px-1">
                        <span className="text-[10px] text-slate-500">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {mine && <ReceiptTicks status={receiptFor(m.created_at, otherRead, otherDelivered)} />}
                        {m.attachment_path && (
                          <button
                            onClick={() => download(m)}
                            aria-label="Download file"
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-200 transition-opacity"
                          >
                            <Download size={13} />
                          </button>
                        )}
                        {mine && m.attachment_path && (
                          <button
                            onClick={() => removeMessage(m)}
                            aria-label="Delete attachment"
                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-opacity"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-slate-800 p-3 shrink-0 bg-[#0E0B24]">
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFile} />
                <EmojiPicker
                  onPick={insertEmoji}
                  size={18}
                  buttonClassName="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Attach file"
                  className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0"
                >
                  {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  onPaste={handlePaste}
                  rows={1}
                  placeholder={uploading ? 'Uploading…' : 'Type a message…  (Enter to send, Shift+Enter for newline, paste an image to attach)'}
                  className="flex-1 resize-none max-h-32 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || sending}
                  aria-label="Send message"
                  className="p-2.5 rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── New-chat contact picker ───────────────────────────────────────── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60" onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-md bg-[#0E0B24] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-semibold text-slate-100">New message</span>
              <button onClick={() => setPickerOpen(false)} aria-label="Close" className="p-1 text-slate-500 hover:text-white rounded">
                <X size={16} />
              </button>
            </div>
            <div className="p-3 border-b border-slate-800">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </div>
            </div>
            <ul className="list-none m-0 p-0 max-h-72 overflow-y-auto divide-y divide-slate-800/70">
              {filteredContacts.length === 0 ? (
                <li className="text-center text-sm text-slate-500 py-8">No team members found</li>
              ) : filteredContacts.map((c) => (
                <li key={c.id}>
                  <button onClick={() => startConversation(c)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                    <Avatar name={c.full_name} online={onlineUsers.has(c.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200 truncate">{c.full_name}</p>
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', ROLE_BADGE[c.role] ?? 'bg-slate-700 text-slate-300')}>
                        {formatRole(c.role)}
                      </span>
                    </div>
                    {onlineUsers.has(c.id) && <span className="text-[11px] text-green-400 shrink-0">Online</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
