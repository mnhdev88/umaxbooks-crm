'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ChatContact, ChatMessage } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { MESSAGE_COLUMNS } from './conversation'
import { uploadChatFile, MAX_ATTACHMENT_BYTES, downloadAttachment, deleteChatMessage } from './attachments'
import { EmojiPicker } from './EmojiPicker'
import { MessageRow } from './MessageRow'
import { MentionTextarea, MentionTextareaHandle, extractMentions } from './MentionTextarea'
import { useReactions } from './Reactions'
import { useTyping, typingLabel } from './typing'
import { toast } from 'sonner'
import { Send, X, Minus, Paperclip, Loader2, Hash } from 'lucide-react'

// A floating chat window. Handles both a 1:1 DM and a team channel (082).
//
// ── What this window deliberately does NOT do ──────────────────────────────
// Threads. A reply pane inside a 320px popup would be unusable, so a message
// with replies shows a pill that opens the full Messages page at that thread
// (/messages?c=…&t=…). Quick back-and-forth happens here; thread work happens
// there.

interface Props {
  userId: string
  myName: string
  conversationId: string
  // Null for a team channel — a group has no single "other person".
  contact: ChatContact | null
  title?: string | null
  isGroup?: boolean
  online: boolean
  onClose: () => void
  className?: string
  style?: React.CSSProperties
}

export function ChatWindow({
  userId, myName, conversationId, contact, title, isGroup = false, online, onClose, className, style,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [members, setMembers] = useState<ChatContact[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [lastSeen, setLastSeen] = useState<string | null>(contact?.last_seen_at ?? null)
  const [otherRead, setOtherRead] = useState<string | null>(null)
  const [otherDelivered, setOtherDelivered] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<MentionTextareaHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { byMessage: reactionsByMessage } = useReactions(conversationId)
  const { typists, notifyTyping, clearTyping } = useTyping(conversationId, userId, myName)
  const mentionable = members.filter((m) => m.id !== userId)

  const headerName = isGroup ? (title ?? 'Team') : (contact?.full_name ?? 'Unknown')

  // Members are fetched here rather than passed in: the window is restored from
  // localStorage across tabs and reloads, so a persisted roster would go stale
  // exactly when 082 re-syncs the team.
  useEffect(() => {
    let active = true
    supabase
      .from('conversation_participants')
      .select('user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)')
      .eq('conversation_id', conversationId)
      .then(({ data }) => {
        if (!active) return
        setMembers((data ?? []).map((r) => r.profile).filter(Boolean) as unknown as ChatContact[])
      })
    return () => { active = false }
  }, [supabase, conversationId])

  // Refresh "last seen" the moment they're offline, so it isn't a stale snapshot.
  // DMs only — a channel has no single counterpart to be "last seen".
  useEffect(() => {
    if (isGroup || !contact) return
    if (online) return
    let active = true
    supabase.from('profiles').select('last_seen_at').eq('id', contact.id).single()
      .then(({ data }) => { if (active && data) setLastSeen(data.last_seen_at) })
    return () => { active = false }
  }, [online, contact, isGroup, supabase])

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
      // Top-level only: replies belong to their thread on the full page.
      .is('parent_message_id', null)
      .order('created_at', { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (!active) return
        setMessages((data as ChatMessage[]) ?? [])
        setLoading(false)
        markRead()
      })

    // Receipt timestamps for my ticks — DMs only. In a group this filter matches
    // every other member, and maybeSingle() would throw on the extra rows.
    if (!isGroup) {
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
    }

    const channel = supabase
      .channel(`chat-window-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const msg = payload.new as ChatMessage
        if (msg.parent_message_id) return   // thread replies aren't shown here
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])
        if (msg.sender_id !== userId) markRead()
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        // Keeps the "N replies" pill live when someone replies in a thread.
        const msg = payload.new as ChatMessage
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, reply_count: msg.reply_count } : m))
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

  async function send() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setInput('')
    clearTyping()
    const ok = await insertMessage({ body, mentions: extractMentions(body, mentionable) })
    setSending(false)
    if (!ok) setInput(body)
    inputRef.current?.focus()
  }

  async function removeMessage(m: ChatMessage) {
    const what = m.attachment_path ? 'attachment' : 'message'
    if (!window.confirm(`Delete this ${what} for everyone?`)) return
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
        await insertMessage({
          body: i === 0 ? (caption || null) : null,
          mentions: i === 0 ? extractMentions(caption, mentionable) : [],
          ...attachment,
        })
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

  const typing = typingLabel(typists)

  return (
    <div
      className={cn(
        'pointer-events-auto flex flex-col overflow-hidden rounded-t-xl border border-slate-700 bg-[#0E0B24] shadow-2xl',
        'w-[88vw] sm:w-80',
        className
      )}
      style={style}
    >
      {/* Header */}
      <div
        className="flex shrink-0 cursor-pointer items-center gap-2 bg-[#160E32] px-3 py-2"
        onClick={() => setMinimized((m) => !m)}
      >
        <div className="relative shrink-0">
          <div className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white',
            isGroup ? 'bg-gradient-to-br from-slate-600 to-slate-800' : 'bg-gradient-to-br from-orange-500 to-orange-700'
          )}>
            {isGroup ? <Hash size={14} /> : (contact?.full_name ?? '?').charAt(0).toUpperCase()}
          </div>
          {!isGroup && online && <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full bg-green-500 ring-2 ring-[#160E32]" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight text-slate-100">{headerName}</p>
          {isGroup ? (
            <p className="text-[10px] leading-tight text-slate-500">{members.length} members</p>
          ) : (
            <p className={cn('text-[10px] leading-tight', online ? 'text-green-400' : 'text-slate-500')}>
              {online ? 'Active now' : lastSeen ? `Last seen ${timeAgo(lastSeen)}` : 'Offline'}
            </p>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMinimized((m) => !m) }}
          aria-label="Minimize"
          className="rounded p-1 text-slate-400 hover:text-white"
        >
          <Minus size={15} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          aria-label="Close chat"
          className="rounded p-1 text-slate-400 hover:text-white"
        >
          <X size={15} />
        </button>
      </div>

      {!minimized && (
        <>
          <div className="h-80 space-y-2 overflow-y-auto bg-[#07061A] px-3 py-3">
            {loading ? (
              <p className="py-6 text-center text-[11px] text-slate-500">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="py-6 text-center text-[11px] text-slate-500">
                {isGroup ? 'No messages yet 👋' : 'No messages yet. Say hello 👋'}
              </p>
            ) : (
              messages.map((m, i) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  userId={userId}
                  members={members}
                  isGroup={isGroup}
                  reactions={reactionsByMessage.get(m.id) ?? []}
                  showSender={i === 0 || messages[i - 1].sender_id !== m.sender_id}
                  showReceipts={!isGroup}
                  otherRead={otherRead}
                  otherDelivered={otherDelivered}
                  // Threads need room — hand off to the full page.
                  onOpenThread={(msg) => router.push(`/messages?c=${conversationId}&t=${msg.id}`)}
                  onDownload={download}
                  onDelete={removeMessage}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {typing && (
            <p className="bg-[#07061A] px-3 pb-1 text-[10px] italic text-slate-500" aria-live="polite">{typing}</p>
          )}

          <div className="flex shrink-0 items-end gap-1.5 border-t border-slate-800 p-2">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFile} />
            <EmojiPicker
              onPick={(e) => inputRef.current?.insertAtCursor(e)}
              size={16}
              buttonClassName="shrink-0 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Attach file"
              className="shrink-0 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            </button>
            <MentionTextarea
              ref={inputRef}
              value={input}
              onChange={setInput}
              onSubmit={send}
              onTyping={notifyTyping}
              onPaste={handlePaste}
              members={mentionable}
              placeholder={uploading ? 'Uploading…' : 'Aa'}
              className={cn(
                'max-h-24 w-full resize-none rounded-full border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-[13px]',
                'text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50'
              )}
            />
            <button
              onClick={send}
              disabled={!input.trim() || sending}
              aria-label="Send"
              className="shrink-0 rounded-full bg-orange-500 p-2 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
