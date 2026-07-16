'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOnlineUsers } from '@/components/layout/presence'
import { ChatContact, ChatConversation } from '@/types'
import { buildConversations, conversationName, sortConversations,
         ConversationRow, MemberRow, RecentMessageRow } from './conversation'
import { cn, timeAgo } from '@/lib/utils'
import { toast } from 'sonner'
import { MessageCircle, X, Search, PenSquare, ArrowLeft, Hash } from 'lucide-react'
import { ChatWindow } from './ChatWindow'

const ROLE_BADGE: Record<string, string> = {
  admin:         'bg-orange-500/20 text-orange-400',
  agent:         'bg-blue-500/20 text-blue-400',
  sales_agent:   'bg-purple-500/20 text-purple-400',
  // Was missing, so sales managers rendered with no badge styling at all.
  sales_manager: 'bg-emerald-500/20 text-emerald-400',
  developer:     'bg-cyan-500/20 text-cyan-400',
}
function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function AvatarDot({ name, online, group }: { name: string; online: boolean; group?: boolean }) {
  return (
    <div className="relative shrink-0">
      <div className={cn(
        'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white',
        group ? 'bg-gradient-to-br from-slate-600 to-slate-800' : 'bg-gradient-to-br from-orange-500 to-orange-700'
      )}>
        {group ? <Hash size={16} /> : (name ?? '?').charAt(0).toUpperCase()}
      </div>
      {!group && (
        <span className={cn(
          'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-[#0E0B24]',
          online ? 'bg-green-500' : 'bg-slate-600'
        )} />
      )}
    </div>
  )
}

// An open window. `contact` is null for a team channel (082) — a group has no
// single counterpart. Windows persist to localStorage, so entries written before
// groups existed lack isGroup/title; both are optional and default to a DM,
// which is exactly what those old entries are.
interface OpenWindow {
  conversationId: string
  contact: ChatContact | null
  title?: string | null
  isGroup?: boolean
}
const MAX_WINDOWS = 3

export function ChatWidget({ userId, myName, myRole }: { userId: string; myName: string; myRole: string }) {
  const supabase = createClient()
  const online = useOnlineUsers()

  const [panelOpen, setPanelOpen] = useState(false)
  const [composing, setComposing] = useState(false)   // people list vs. recent conversations
  const [contacts, setContacts] = useState<ChatContact[]>([])
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [unread, setUnread] = useState(0)
  const [search, setSearch] = useState('')

  // Open chat windows are shared across this browser's tabs/windows: persisted
  // to localStorage (so a new tab hydrates them) and synced live via the
  // `storage` event (which fires in OTHER tabs whenever the value changes).
  const STORAGE_KEY = `umax-chat-windows:${userId}`

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setWindows(JSON.parse(raw) as OpenWindow[])
    } catch { /* ignore corrupt/unavailable storage */ }

    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      try { setWindows(e.newValue ? (JSON.parse(e.newValue) as OpenWindow[]) : []) } catch { /* ignore */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [STORAGE_KEY])

  // Persist a new windows array and broadcast it to the other tabs.
  function persistWindows(next: OpenWindow[]) {
    setWindows(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // Roster: all staff except me (loaded once).
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url, last_seen_at')
      .neq('role', 'client')
      .neq('id', userId)
      .order('full_name')
      .then(({ data }) => setContacts((data ?? []) as ChatContact[]))
  }, [userId, supabase])

  const fetchUnread = useCallback(async () => {
    const { data } = await supabase.rpc('chat_unread_count')
    setUnread(typeof data === 'number' ? data : 0)
  }, [supabase])

  // Build the "recent conversations" list (threads that have at least one message).
  const loadConversations = useCallback(async () => {
    const { data: myParts } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId)

    const ids = (myParts ?? []).map((p) => p.conversation_id)
    if (ids.length === 0) { setConversations([]); return }
    const lastReadById = new Map((myParts ?? []).map((p) => [p.conversation_id, p.last_read_at]))

    const [{ data: convs }, { data: members }, { data: recent }] = await Promise.all([
      supabase.from('conversations').select('id, is_group, title, team_manager_id, last_message_at, created_at').in('id', ids),
      supabase.from('conversation_participants').select('conversation_id, user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)').in('conversation_id', ids),
      supabase.from('messages').select('conversation_id, body, created_at, sender_id, attachment_name, attachment_path, parent_message_id').in('conversation_id', ids).order('created_at', { ascending: false }).limit(400),
    ])

    const list = buildConversations(
      userId,
      (convs ?? []) as ConversationRow[],
      (members ?? []) as unknown as MemberRow[],
      (recent ?? []) as RecentMessageRow[],
      lastReadById,
    )
    // Empty DMs stay hidden (they'd be noise), but a team channel shows even
    // with no messages — otherwise a manager could never find it here to send
    // the first one, since the widget is the only chat entry point on most pages.
    setConversations(sortConversations(list.filter((c) => c.last_message !== null || c.is_group)))
  }, [supabase, userId])

  // Materialise the team channel (082) from anywhere in the app, not just
  // /messages: sales staff who never open that page should still find their team
  // channel in the widget. Idempotent, and re-syncs the roster from manager_id.
  // Errors are ignored — an agent with no manager assigned simply has no channel.
  useEffect(() => {
    if (myRole !== 'sales_manager' && myRole !== 'sales_agent') return
    supabase.rpc('get_or_create_team_group').then(() => loadConversations())
  }, [myRole, supabase, loadConversations])

  // Live: refresh badge + recent list whenever a relevant change comes in.
  useEffect(() => {
    fetchUnread()
    loadConversations()
    const channel = supabase
      .channel('chat-widget')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as { conversation_id: string; sender_id: string }
        // Acknowledge delivery of messages others send me (powers ✓✓ for them).
        if (msg.sender_id !== userId) {
          supabase.rpc('mark_delivered', { p_conversation: msg.conversation_id }).then(() => {}, () => {})
        }
        fetchUnread(); loadConversations()
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => { fetchUnread(); loadConversations() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, () => { fetchUnread(); loadConversations() })
      // Someone started a brand-new DM with me, or added me to a channel → my
      // participant row appears.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, () => { fetchUnread(); loadConversations() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, userId, fetchUnread, loadConversations])

  // Refresh recents each time the panel is opened.
  useEffect(() => { if (panelOpen) loadConversations() }, [panelOpen, loadConversations])

  function addWindow(w: OpenWindow) {
    setPanelOpen(false)
    setComposing(false)
    setSearch('')
    setConversations((prev) => prev.map((c) => c.id === w.conversationId ? { ...c, unread: false } : c))
    if (windows.some((x) => x.conversationId === w.conversationId)) return
    persistWindows([...windows, w].slice(-MAX_WINDOWS))
  }

  // Open (or create) a DM with a team member — used by the People list.
  async function openChat(contact: ChatContact) {
    const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: contact.id })
    if (error || !convId) { toast.error('Could not open chat'); return }
    addWindow({ conversationId: convId as string, contact })
  }

  // Reopen an existing conversation — used by the Recent list.
  function openConversation(conv: ChatConversation) {
    if (conv.is_group) {
      addWindow({ conversationId: conv.id, contact: null, title: conv.title, isGroup: true })
      return
    }
    if (!conv.other) return
    addWindow({ conversationId: conv.id, contact: conv.other })
  }

  function closeWindow(conversationId: string) {
    persistWindows(windows.filter((w) => w.conversationId !== conversationId))
  }

  const filteredContacts = contacts
    .filter((c) => c.full_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)))
  const onlineCount = contacts.filter((c) => online.has(c.id)).length
  const showPeople = composing || search.trim().length > 0

  return (
    <>
      {/* Docked chat windows (stacked from the right, left of the launcher) */}
      <div className="pointer-events-none fixed bottom-0 right-4 z-50 flex flex-row-reverse items-end gap-3 sm:right-24">
        {windows.map((w) => (
          <ChatWindow
            key={w.conversationId}
            userId={userId}
            myName={myName}
            conversationId={w.conversationId}
            contact={w.contact}
            title={w.title}
            isGroup={w.isGroup}
            online={!!w.contact && online.has(w.contact.id)}
            onClose={() => closeWindow(w.conversationId)}
          />
        ))}
      </div>

      {/* Panel */}
      {panelOpen && (
        <div className="fixed bottom-24 right-4 z-50 w-[88vw] overflow-hidden rounded-2xl border border-slate-700 bg-[#0E0B24] shadow-2xl sm:right-6 sm:w-80">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2">
              {showPeople && (
                <button
                  onClick={() => { setComposing(false); setSearch('') }}
                  aria-label="Back to chats"
                  className="-ml-1 rounded p-1 text-slate-400 hover:text-white"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <div>
                <p className="text-sm font-semibold text-slate-100">{showPeople ? 'New message' : 'Chats'}</p>
                <p className="text-[11px] text-green-400">{onlineCount} online</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!showPeople && (
                <button
                  onClick={() => setComposing(true)}
                  aria-label="New message"
                  className="rounded p-1.5 text-slate-400 hover:text-white"
                >
                  <PenSquare size={16} />
                </button>
              )}
              <button onClick={() => setPanelOpen(false)} aria-label="Close" className="rounded p-1 text-slate-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
          </div>

          {showPeople && (
            <div className="border-b border-slate-800 p-3">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </div>
            </div>
          )}

          {/* People list */}
          {showPeople ? (
            <ul className="m-0 max-h-80 list-none divide-y divide-slate-800/70 overflow-y-auto p-0">
              {filteredContacts.length === 0 ? (
                <li className="py-8 text-center text-sm text-slate-500">No team members found</li>
              ) : filteredContacts.map((c) => {
                const isOnline = online.has(c.id)
                return (
                  <li key={c.id}>
                    <button onClick={() => openChat(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-800/60">
                      <AvatarDot name={c.full_name} online={isOnline} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-200">{c.full_name}</p>
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px]', ROLE_BADGE[c.role] ?? 'bg-slate-700 text-slate-300')}>
                          {formatRole(c.role)}
                        </span>
                      </div>
                      {isOnline && <span className="shrink-0 text-[11px] text-green-400">online</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            /* Recent conversations */
            <ul className="m-0 max-h-96 list-none divide-y divide-slate-800/70 overflow-y-auto p-0">
              {conversations.length === 0 ? (
                <li className="flex flex-col items-center px-6 py-12 text-center text-slate-500">
                  <MessageCircle size={26} className="mb-2 opacity-50" />
                  <p className="text-sm">No chats yet.</p>
                  <button onClick={() => setComposing(true)} className="mt-3 text-xs text-orange-400 hover:text-orange-300">
                    Start a conversation
                  </button>
                </li>
              ) : conversations.map((c) => {
                const name = conversationName(c)
                return (
                  <li key={c.id}>
                    <button onClick={() => openConversation(c)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-800/60">
                      <AvatarDot name={name} group={c.is_group} online={!!c.other && online.has(c.other.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('truncate text-sm', c.unread ? 'font-semibold text-white' : 'font-medium text-slate-200')}>
                            {name}
                          </span>
                          <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.last_message_at)}</span>
                        </div>
                        <p className={cn('mt-0.5 truncate text-xs', c.unread ? 'text-slate-200' : 'text-slate-500')}>
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
      )}

      {/* Launcher */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        aria-label={unread > 0 ? `Chat — ${unread} unread` : 'Chat'}
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-orange-500 text-white shadow-2xl transition-colors hover:bg-orange-600 sm:right-6"
      >
        {panelOpen ? <X size={24} /> : <MessageCircle size={24} />}
        {!panelOpen && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold ring-2 ring-[#07061A]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  )
}
