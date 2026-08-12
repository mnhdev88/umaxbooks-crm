'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useOnlineUsers } from '@/components/layout/presence'
import { ChatContact, ChatConversation, ChatMessage } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { describeSupabaseError } from './errorMessage'
import { MESSAGE_COLUMNS, buildConversations, conversationName, messagePreview, sortConversations,
         ConversationRow, MemberRow, RecentMessageRow } from './conversation'
import { uploadChatFile, MAX_ATTACHMENT_BYTES, downloadAttachment, deleteChatMessage } from './attachments'
import { EmojiPicker } from './EmojiPicker'
import { MessageRow } from './MessageRow'
import { MentionTextarea, MentionTextareaHandle, extractMentions } from './MentionTextarea'
import { ThreadPane } from './ThreadPane'
import { MembersPanel } from './MembersPanel'
import { useReactions } from './Reactions'
import { useTyping, typingLabel } from './typing'
import { toast } from 'sonner'
import { Send, Plus, ArrowLeft, Search, MessageSquare, X, Paperclip, Loader2, Users, Hash, LogOut } from 'lucide-react'

const ROLE_BADGE: Record<string, string> = {
  admin:         'bg-orange-500/20 text-orange-400',
  agent:         'bg-blue-500/20 text-blue-400',
  sales_agent:   'bg-purple-500/20 text-purple-400',
  // Was missing, so managers rendered with no badge styling at all.
  sales_manager: 'bg-emerald-500/20 text-emerald-400',
  developer:     'bg-cyan-500/20 text-cyan-400',
}

function Avatar({ name, size = 36, online, group }: { name: string; size?: number; online?: boolean; group?: boolean }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full font-bold text-white',
          group ? 'bg-gradient-to-br from-slate-600 to-slate-800' : 'bg-gradient-to-br from-orange-500 to-orange-700'
        )}
        style={{ fontSize: size * 0.4 }}
      >
        {group ? <Hash size={size * 0.5} /> : (name ?? '?').charAt(0).toUpperCase()}
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
  myName: string
  myRole: string
  contacts: ChatContact[]
  managers: ChatContact[]
  initialConversations: ChatConversation[]
}

export function MessagesClient({ userId, myName, myRole, contacts, managers, initialConversations }: Props) {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const onlineUsers = useOnlineUsers()

  const [conversations, setConversations] = useState<ChatConversation[]>(sortConversations(initialConversations))
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
  const [threadParentId, setThreadParentId] = useState<string | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)

  const activeIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<MentionTextareaHandle>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  activeIdRef.current = activeId

  const activeConv = conversations.find((c) => c.id === activeId) ?? null
  const isGroup = !!activeConv?.is_group
  const isOnline = !!activeConv?.other && onlineUsers.has(activeConv.other.id)
  const memberList = activeConv?.members ?? []
  // Mention targets exclude me — you can't @ yourself.
  const mentionable = memberList.filter((m) => m.id !== userId)

  const { byMessage: reactionsByMessage } = useReactions(activeId)
  const { typists, notifyTyping, clearTyping } = useTyping(activeId, userId, myName)

  const threadParent = messages.find((m) => m.id === threadParentId) ?? null

  // ── Fetch one conversation's metadata (for threads not yet in the list) ────
  const fetchConversationMeta = useCallback(async (convId: string): Promise<ChatConversation | null> => {
    const [{ data: conv }, { data: members }, { data: last }] = await Promise.all([
      supabase.from('conversations').select('id, is_group, title, team_manager_id, last_message_at, created_at').eq('id', convId).single(),
      supabase.from('conversation_participants').select('conversation_id, user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)').eq('conversation_id', convId),
      supabase.from('messages').select('conversation_id, body, created_at, sender_id, attachment_name, attachment_path, parent_message_id')
        .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(20),
    ])
    if (!conv) return null
    // Reuse the list builder so a late-arriving conversation is shaped exactly
    // like a server-rendered one (notably: no arbitrary "other" for a group).
    const [built] = buildConversations(
      userId,
      [conv as ConversationRow],
      (members ?? []) as unknown as MemberRow[],
      (last ?? []) as RecentMessageRow[],
      new Map(),
    )
    return built ?? null
  }, [supabase, userId])

  // ── Load a thread + mark it read ───────────────────────────────────────────
  const openConversation = useCallback(async (convId: string) => {
    setActiveId(convId)
    setThreadParentId(null)
    setLoadingThread(true)
    setOtherRead(null)
    setOtherDelivered(null)

    // Top-level only: replies live in the thread pane (085). Without this filter
    // a channel would interleave every side conversation into the main flow.
    const { data } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', convId)
      .is('parent_message_id', null)
      .order('created_at', { ascending: true })
      .limit(500)
    setMessages((data as ChatMessage[]) ?? [])
    setLoadingThread(false)

    // Receipt timestamps for my ticks — DMs only. In a group there is no single
    // "other participant", and this query would match several rows and make
    // maybeSingle() throw. Groups use reactions to acknowledge instead (083).
    const conv = conversations.find((c) => c.id === convId)
    if (!conv?.is_group) {
      supabase
        .from('conversation_participants')
        .select('last_read_at, delivered_at')
        .eq('conversation_id', convId)
        .neq('user_id', userId)
        .maybeSingle()
        .then(({ data: p }) => { if (p) { setOtherRead(p.last_read_at); setOtherDelivered(p.delivered_at) } })
    }

    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convId)
      .eq('user_id', userId)
    setConversations((prev) => prev.map((c) => c.id === convId ? { ...c, unread: false } : c))
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [supabase, userId, conversations])

  // ── Realtime: any new message I'm allowed to see (RLS-filtered stream) ─────
  useEffect(() => {
    const channel = supabase
      .channel('chat-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as ChatMessage

        // Thread replies are the ThreadPane's business. They must not enter the
        // channel flow, nor become its preview line.
        if (msg.parent_message_id) return

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

        setConversations((prev) => {
          const existing = prev.find((c) => c.id === msg.conversation_id)
          if (!existing) {
            // A thread I've just been added to (e.g. a team channel) — fetch its
            // metadata, then prepend.
            fetchConversationMeta(msg.conversation_id).then((meta) => {
              if (!meta) return
              setConversations((cur) =>
                cur.some((c) => c.id === meta.id)
                  ? cur
                  : sortConversations([{ ...meta, unread: msg.sender_id !== userId }, ...cur])
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
          return sortConversations([updated, ...prev.filter((c) => c.id !== msg.conversation_id)])
        })
      })
      // reply_count is denormalised on the parent (085); this keeps the
      // "N replies" pill live when someone else replies in a thread.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as ChatMessage
        if (msg.conversation_id !== activeIdRef.current) return
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, reply_count: msg.reply_count } : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) => {
        const old = payload.old as { id: string; conversation_id?: string }
        if (old.conversation_id === activeIdRef.current || !old.conversation_id) {
          setMessages((prev) => prev.filter((m) => m.id !== old.id))
          setThreadParentId((cur) => cur === old.id ? null : cur)
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

  // ── Deep link: /messages?c=<id> opens that thread, &t=<id> opens a thread ──
  useEffect(() => {
    const c = searchParams.get('c')
    if (!c) return
    const t = searchParams.get('t')
    openConversation(c).then(() => { if (t) setThreadParentId(t) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Refresh "last seen" for the open DM's other user when they're offline.
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

  async function addAndOpen(convId: string) {
    if (!conversations.some((c) => c.id === convId)) {
      const meta = await fetchConversationMeta(convId)
      if (meta) setConversations((prev) => sortConversations([meta, ...prev]))
    }
    openConversation(convId)
  }

  // ── Start (or open existing) DM with a contact ─────────────────────────────
  async function startConversation(contact: ChatContact) {
    setPickerOpen(false)
    setContactSearch('')
    const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: contact.id })
    if (error || !convId) {
      toast.error(`Could not start conversation: ${describeSupabaseError(error)}`)
      return
    }
    addAndOpen(convId as string)
  }

  // ── Join a manager's team channel (admins pick which) ─────────────────────
  // Confirmed, because for an admin opening IS joining — the RPC adds them as a
  // participant, and a team channel is meant to be the manager and their agents.
  // Without this, an admin who clicks the entry merely to look ends up a visible
  // member receiving the team's messages, which is not what they asked for.
  async function openTeamChannel(manager: ChatContact) {
    const ok = window.confirm(
      `Join ${manager.full_name}'s Team?\n\n` +
      `You'll become a visible member and receive the team's messages and push notifications. ` +
      `You can leave again from the channel header.`
    )
    if (!ok) return
    setPickerOpen(false)
    setContactSearch('')
    const { data: convId, error } = await supabase.rpc('get_or_create_team_group', { p_manager: manager.id })
    if (error || !convId) {
      toast.error(`Could not open team channel: ${describeSupabaseError(error)}`)
      return
    }
    addAndOpen(convId as string)
  }

  // ── Send a message (text and/or attachment) ───────────────────────────────
  async function insertMessage(convId: string, row: Record<string, unknown>): Promise<boolean> {
    // sender_id is deliberately omitted — migration 104 stamps it from auth.uid(). Sending
    // the `userId` prop instead used to fail RLS whenever the prop went stale against the
    // live JWT (in-tab account switch), since the policy requires sender_id = auth.uid().
    const { data, error } = await supabase
      .from('messages')
      .insert({ conversation_id: convId, ...row })
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
      return sortConversations([
        { ...existing, last_message: messagePreview(msg), last_message_at: msg.created_at, unread: false },
        ...prev.filter((c) => c.id !== convId),
      ])
    })
    return true
  }

  async function send() {
    const body = input.trim()
    if (!body || !activeId || sending) return
    setSending(true)
    setInput('')
    clearTyping()
    const ok = await insertMessage(activeId, { body, mentions: extractMentions(body, mentionable) })
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
        await insertMessage(convId, {
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
    const what = m.attachment_path ? 'attachment' : 'message'
    if (!window.confirm(`Delete this ${what} for everyone?`)) return
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

  // Re-pull just the roster of the open channel after a membership change.
  // Cheaper and less disruptive than refetching the whole conversation, which
  // would also reset the preview line and unread flag.
  const refreshMembers = useCallback(async () => {
    if (!activeId) return
    const { data } = await supabase
      .from('conversation_participants')
      .select('user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)')
      .eq('conversation_id', activeId)
    const list = (data ?? []).map((r) => r.profile).filter(Boolean) as unknown as ChatContact[]
    setConversations((prev) => prev.map((c) => c.id === activeId ? { ...c, members: list } : c))
  }, [supabase, activeId])

  // ── Leave a team channel (admins only — see 086) ──────────────────────────
  // A manager's or agent's membership is derived from manager_id and would just
  // be re-synced back, so the button is only offered to admins.
  async function leaveChannel(conv: ChatConversation) {
    if (!window.confirm(`Leave ${conversationName(conv)}? You'll stop receiving its messages.`)) return
    const { error } = await supabase.rpc('leave_team_channel', { p_conversation: conv.id })
    if (error) { toast.error(`Could not leave: ${describeSupabaseError(error)}`); return }
    setConversations((prev) => prev.filter((c) => c.id !== conv.id))
    setActiveId(null)
    setThreadParentId(null)
    toast.success(`Left ${conversationName(conv)}`)
  }

  // Optimistic bump for my own reply; the messages UPDATE subscription then
  // reconciles against the authoritative count.
  function bumpReplyCount(parentId: string, delta: number) {
    setMessages((prev) => prev.map((m) =>
      m.id === parentId ? { ...m, reply_count: Math.max((m.reply_count ?? 0) + delta, 0) } : m
    ))
  }

  const filteredContacts = contacts
    .filter((c) => c.full_name.toLowerCase().includes(contactSearch.toLowerCase()))
    .sort((a, b) => Number(onlineUsers.has(b.id)) - Number(onlineUsers.has(a.id)))
  const filteredManagers = managers
    .filter((m) => m.full_name.toLowerCase().includes(contactSearch.toLowerCase()))

  const typing = typingLabel(typists)

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">

      {/* ── Conversation list ─────────────────────────────────────────────── */}
      <aside className={cn(
        'flex w-full flex-col border-r border-slate-800 bg-[#0E0B24] md:w-80 md:shrink-0',
        activeId ? 'hidden md:flex' : 'flex'
      )}>
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-sm font-semibold text-slate-100">Conversations</span>
          <button
            onClick={() => setPickerOpen(true)}
            aria-label="New message"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-slate-500">
              <MessageSquare size={28} className="mb-2 opacity-50" />
              <p className="text-sm">No conversations yet.</p>
              <button onClick={() => setPickerOpen(true)} className="mt-3 text-xs text-orange-400 hover:text-orange-300">
                Start a chat
              </button>
            </div>
          ) : (
            <ul className="m-0 list-none divide-y divide-slate-800/70 p-0">
              {conversations.map((c) => {
                const name = conversationName(c)
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => openConversation(c.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                        c.id === activeId ? 'bg-orange-500/10' : 'hover:bg-slate-800/60'
                      )}
                    >
                      <Avatar name={name} group={c.is_group} online={!!c.other && onlineUsers.has(c.other.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-sm', c.unread ? 'font-semibold text-white' : 'font-medium text-slate-200')}>
                            {name}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.last_message_at)}</span>
                        </div>
                        <p className={cn('mt-0.5 truncate text-xs', c.unread ? 'text-slate-300' : 'text-slate-500')}>
                          {c.is_group && c.members ? `${c.members.length} members · ` : ''}
                          {c.last_message ?? 'No messages yet'}
                        </p>
                      </div>
                      {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-label="Unread" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Active thread ─────────────────────────────────────────────────── */}
      <section className={cn('min-w-0 flex-1 flex-col bg-[#07061A]', activeId ? 'flex' : 'hidden md:flex')}>
        {!activeConv ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500">
            <MessageSquare size={40} className="mb-3 opacity-40" />
            <p className="text-sm">Select a conversation to start chatting.</p>
          </div>
        ) : (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-800 bg-[#160E32]/60 px-4">
              <button
                onClick={() => setActiveId(null)}
                aria-label="Back to conversations"
                className="-ml-1.5 rounded p-1.5 text-slate-400 hover:text-white md:hidden"
              >
                <ArrowLeft size={18} />
              </button>
              <Avatar
                name={conversationName(activeConv)}
                size={32}
                group={isGroup}
                online={!!activeConv.other && onlineUsers.has(activeConv.other.id)}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight text-slate-100">
                  {conversationName(activeConv)}
                </p>
                {isGroup ? (
                  <button
                    onClick={() => setMembersOpen(true)}
                    className="flex items-center gap-1 text-[11px] leading-tight text-slate-500 transition-colors hover:text-slate-300"
                  >
                    <Users size={11} />
                    {memberList.length} members
                    {/* Auto-synced from manager_id — nobody maintains this list. */}
                    {activeConv.team_manager_id && ' · auto-synced'}
                  </button>
                ) : activeConv.other && (
                  isOnline
                    ? <span className="flex items-center gap-1 text-[11px] leading-tight text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />Active now
                      </span>
                    : <span className="text-[11px] leading-tight text-slate-500">
                        {activeLastSeen ? `Last seen ${timeAgo(activeLastSeen)}` : formatRole(activeConv.other.role)}
                      </span>
                )}
              </div>

              {/* Admins opt IN to a team channel, so they get an opt-out. The
                  manager and their agents belong here by org structure — for
                  them the roster re-sync would just add them straight back. */}
              {isGroup && myRole === 'admin' && (
                <button
                  onClick={() => leaveChannel(activeConv)}
                  className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:border-red-500/50 hover:text-red-400"
                >
                  <LogOut size={12} />
                  Leave
                </button>
              )}
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
                  {loadingThread ? (
                    <p className="py-8 text-center text-xs text-slate-500">Loading…</p>
                  ) : messages.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">
                      {isGroup ? 'No messages yet. Say something to your team 👋' : 'No messages yet. Say hello 👋'}
                    </p>
                  ) : (
                    messages.map((m, i) => (
                      <MessageRow
                        key={m.id}
                        message={m}
                        userId={userId}
                        members={memberList}
                        isGroup={isGroup}
                        reactions={reactionsByMessage.get(m.id) ?? []}
                        showSender={i === 0 || messages[i - 1].sender_id !== m.sender_id}
                        // Ticks are a 1:1 concept (064); a channel acknowledges
                        // with reactions instead.
                        showReceipts={!isGroup}
                        otherRead={otherRead}
                        otherDelivered={otherDelivered}
                        onOpenThread={(msg) => setThreadParentId(msg.id)}
                        onDownload={download}
                        onDelete={removeMessage}
                      />
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>

                {typing && (
                  <p className="px-4 pb-1 text-[11px] italic text-slate-500" aria-live="polite">{typing}</p>
                )}

                <div className="shrink-0 border-t border-slate-800 bg-[#0E0B24] p-3">
                  <div className="flex items-end gap-2">
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFile} />
                    <EmojiPicker
                      onPick={(e) => inputRef.current?.insertAtCursor(e)}
                      size={18}
                      buttonClassName="shrink-0 rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      aria-label="Attach file"
                      className="shrink-0 rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
                    >
                      {uploading ? <Loader2 size={18} className="animate-spin" /> : <Paperclip size={18} />}
                    </button>
                    <MentionTextarea
                      ref={inputRef}
                      value={input}
                      onChange={setInput}
                      onSubmit={send}
                      onTyping={notifyTyping}
                      onPaste={handlePaste}
                      members={mentionable}
                      placeholder={uploading
                        ? 'Uploading…'
                        : isGroup
                          ? 'Message your team…  (@ to mention, Enter to send)'
                          : 'Type a message…  (Enter to send, Shift+Enter for newline)'}
                      className={cn(
                        'max-h-32 w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm',
                        'text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50'
                      )}
                    />
                    <button
                      onClick={send}
                      disabled={!input.trim() || sending}
                      aria-label="Send message"
                      className="shrink-0 rounded-xl bg-orange-500 p-2.5 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </div>
              </div>

              {membersOpen && (
                <MembersPanel
                  conversation={activeConv}
                  userId={userId}
                  myRole={myRole}
                  members={memberList}
                  onClose={() => setMembersOpen(false)}
                  onChanged={refreshMembers}
                />
              )}

              {threadParent && activeId && (
                <ThreadPane
                  parent={threadParent}
                  conversationId={activeId}
                  userId={userId}
                  myName={myName}
                  members={memberList}
                  isGroup={isGroup}
                  reactionsByMessage={reactionsByMessage}
                  onClose={() => setThreadParentId(null)}
                  onReplyCountChange={bumpReplyCount}
                />
              )}
            </div>
          </>
        )}
      </section>

      {/* ── New-chat picker ───────────────────────────────────────────────── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-[#0E0B24] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <span className="text-sm font-semibold text-slate-100">New message</span>
              <button onClick={() => setPickerOpen(false)} aria-label="Close" className="rounded p-1 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="border-b border-slate-800 p-3">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {/* Admins have no team of their own, so they pick whose to open. */}
              {filteredManagers.length > 0 && (
                <>
                  <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Team channels
                  </p>
                  <ul className="m-0 list-none p-0">
                    {filteredManagers.map((m) => (
                      <li key={`team-${m.id}`}>
                        <button onClick={() => openTeamChannel(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/60">
                          <Avatar name={m.full_name} group />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-200">{m.full_name}&apos;s Team</p>
                            <p className="text-[10px] text-amber-500/80">Joins you as a visible member</p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Direct messages
              </p>
              <ul className="m-0 list-none divide-y divide-slate-800/70 p-0">
                {filteredContacts.length === 0 ? (
                  <li className="py-8 text-center text-sm text-slate-500">No team members found</li>
                ) : filteredContacts.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => startConversation(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-800/60">
                      <Avatar name={c.full_name} online={onlineUsers.has(c.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-200">{c.full_name}</p>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', ROLE_BADGE[c.role] ?? 'bg-slate-700 text-slate-300')}>
                          {formatRole(c.role)}
                        </span>
                      </div>
                      {onlineUsers.has(c.id) && <span className="shrink-0 text-[11px] text-green-400">Online</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
