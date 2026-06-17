'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOnlineUsers } from '@/components/layout/presence'
import { ChatContact, ChatConversation } from '@/types'
import { cn, timeAgo } from '@/lib/utils'
import { toast } from 'sonner'
import { MessageCircle, X, Search, PenSquare, ArrowLeft } from 'lucide-react'
import { ChatWindow } from './ChatWindow'

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-orange-500/20 text-orange-400',
  agent:       'bg-blue-500/20 text-blue-400',
  sales_agent: 'bg-purple-500/20 text-purple-400',
  developer:   'bg-cyan-500/20 text-cyan-400',
}
function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function AvatarDot({ name, online }: { name: string; online: boolean }) {
  return (
    <div className="relative shrink-0">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-sm font-bold">
        {(name ?? '?').charAt(0).toUpperCase()}
      </div>
      <span className={cn(
        'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[#0E0B24]',
        online ? 'bg-green-500' : 'bg-slate-600'
      )} />
    </div>
  )
}

interface OpenWindow { conversationId: string; contact: ChatContact }
const MAX_WINDOWS = 3

export function ChatWidget({ userId }: { userId: string }) {
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
  }, [userId])

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
      supabase.from('conversations').select('id, is_group, title, last_message_at, created_at').in('id', ids),
      supabase.from('conversation_participants').select('conversation_id, user_id, profile:profiles(id, full_name, role, avatar_url, last_seen_at)').in('conversation_id', ids),
      supabase.from('messages').select('conversation_id, body, created_at, sender_id').in('conversation_id', ids).order('created_at', { ascending: false }).limit(400),
    ])

    const otherByConv = new Map<string, ChatContact>()
    for (const m of members ?? []) {
      if (m.user_id !== userId && m.profile) otherByConv.set(m.conversation_id, m.profile as unknown as ChatContact)
    }
    const lastByConv = new Map<string, { body: string; created_at: string; sender_id: string }>()
    for (const msg of recent ?? []) {
      if (!lastByConv.has(msg.conversation_id)) lastByConv.set(msg.conversation_id, msg)
    }

    const list = (convs ?? [])
      .map((c): ChatConversation => {
        const last = lastByConv.get(c.id)
        const lastRead = lastReadById.get(c.id)
        const unread = !!last && last.sender_id !== userId &&
          (!lastRead || new Date(last.created_at) > new Date(lastRead))
        return {
          id: c.id,
          is_group: c.is_group,
          title: c.title,
          last_message_at: c.last_message_at,
          created_at: c.created_at,
          other: otherByConv.get(c.id) ?? null,
          last_message: last?.body ?? null,
          unread,
        }
      })
      .filter((c) => c.last_message != null)   // hide empty just-created threads
      .sort((a, b) => +new Date(b.last_message_at) - +new Date(a.last_message_at))

    setConversations(list)
  }, [supabase, userId])

  // Live: refresh badge + recent list whenever a relevant change comes in.
  useEffect(() => {
    fetchUnread()
    loadConversations()
    const channel = supabase
      .channel('chat-widget')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { fetchUnread(); loadConversations() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, () => { fetchUnread(); loadConversations() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, userId, fetchUnread, loadConversations])

  // Refresh recents each time the panel is opened.
  useEffect(() => { if (panelOpen) loadConversations() }, [panelOpen, loadConversations])

  function addWindow(conversationId: string, contact: ChatContact) {
    setPanelOpen(false)
    setComposing(false)
    setSearch('')
    setConversations((prev) => prev.map((c) => c.id === conversationId ? { ...c, unread: false } : c))
    if (windows.some((w) => w.conversationId === conversationId)) return
    persistWindows([...windows, { conversationId, contact }].slice(-MAX_WINDOWS))
  }

  // Open (or create) a DM with a team member — used by the People list.
  async function openChat(contact: ChatContact) {
    const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: contact.id })
    if (error || !convId) { toast.error('Could not open chat'); return }
    addWindow(convId as string, contact)
  }

  // Reopen an existing conversation — used by the Recent list (history loads in the window).
  function openConversation(conv: ChatConversation) {
    if (!conv.other) return
    addWindow(conv.id, conv.other)
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
      <div className="fixed bottom-0 right-4 sm:right-24 z-50 flex flex-row-reverse items-end gap-3 pointer-events-none">
        {windows.map((w) => (
          <ChatWindow
            key={w.conversationId}
            userId={userId}
            conversationId={w.conversationId}
            contact={w.contact}
            online={online.has(w.contact.id)}
            onClose={() => closeWindow(w.conversationId)}
          />
        ))}
      </div>

      {/* Panel */}
      {panelOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[88vw] sm:w-80 bg-[#0E0B24] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              {showPeople && (
                <button
                  onClick={() => { setComposing(false); setSearch('') }}
                  aria-label="Back to chats"
                  className="p-1 -ml-1 text-slate-400 hover:text-white rounded"
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
                  className="p-1.5 text-slate-400 hover:text-white rounded"
                >
                  <PenSquare size={16} />
                </button>
              )}
              <button onClick={() => setPanelOpen(false)} aria-label="Close" className="p-1 text-slate-500 hover:text-white rounded">
                <X size={16} />
              </button>
            </div>
          </div>

          {showPeople && (
            <div className="p-3 border-b border-slate-800">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </div>
            </div>
          )}

          {/* People list */}
          {showPeople ? (
            <ul className="list-none m-0 p-0 max-h-80 overflow-y-auto divide-y divide-slate-800/70">
              {filteredContacts.length === 0 ? (
                <li className="text-center text-sm text-slate-500 py-8">No team members found</li>
              ) : filteredContacts.map((c) => {
                const isOnline = online.has(c.id)
                return (
                  <li key={c.id}>
                    <button onClick={() => openChat(c)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                      <AvatarDot name={c.full_name} online={isOnline} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{c.full_name}</p>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', ROLE_BADGE[c.role] ?? 'bg-slate-700 text-slate-300')}>
                          {formatRole(c.role)}
                        </span>
                      </div>
                      {isOnline && <span className="text-[11px] text-green-400 shrink-0">online</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            /* Recent conversations */
            <ul className="list-none m-0 p-0 max-h-96 overflow-y-auto divide-y divide-slate-800/70">
              {conversations.length === 0 ? (
                <li className="flex flex-col items-center text-center px-6 py-12 text-slate-500">
                  <MessageCircle size={26} className="mb-2 opacity-50" />
                  <p className="text-sm">No chats yet.</p>
                  <button onClick={() => setComposing(true)} className="mt-3 text-xs text-orange-400 hover:text-orange-300">
                    Start a conversation
                  </button>
                </li>
              ) : conversations.map((c) => {
                const name = c.is_group ? (c.title ?? 'Group') : (c.other?.full_name ?? 'Unknown')
                const isOnline = !!c.other && online.has(c.other.id)
                return (
                  <li key={c.id}>
                    <button onClick={() => openConversation(c)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                      <AvatarDot name={name} online={isOnline} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn('text-sm truncate', c.unread ? 'font-semibold text-white' : 'font-medium text-slate-200')}>
                            {name}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0">{timeAgo(c.last_message_at)}</span>
                        </div>
                        <p className={cn('text-xs truncate mt-0.5', c.unread ? 'text-slate-200' : 'text-slate-500')}>
                          {c.last_message}
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
      )}

      {/* Launcher */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        aria-label={unread > 0 ? `Chat — ${unread} unread` : 'Chat'}
        className="fixed bottom-6 right-4 sm:right-6 z-50 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white shadow-2xl flex items-center justify-center transition-colors"
      >
        {panelOpen ? <X size={24} /> : <MessageCircle size={24} />}
        {!panelOpen && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 rounded-full text-[11px] font-bold flex items-center justify-center ring-2 ring-[#07061A]">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </>
  )
}
