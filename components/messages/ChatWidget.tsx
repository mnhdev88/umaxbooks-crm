'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useOnlineUsers } from '@/components/layout/presence'
import { ChatContact } from '@/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { MessageCircle, X, Search } from 'lucide-react'
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

interface OpenWindow { conversationId: string; contact: ChatContact }
const MAX_WINDOWS = 3

export function ChatWidget({ userId }: { userId: string }) {
  const supabase = createClient()
  const online = useOnlineUsers()

  const [panelOpen, setPanelOpen] = useState(false)
  const [contacts, setContacts] = useState<ChatContact[]>([])
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [unread, setUnread] = useState(0)
  const [search, setSearch] = useState('')

  // Roster: all staff except me (loaded once).
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url')
      .neq('role', 'client')
      .neq('id', userId)
      .order('full_name')
      .then(({ data }) => setContacts((data ?? []) as ChatContact[]))
  }, [userId])

  // Unread badge on the launcher (RLS-filtered message stream → refetch count).
  useEffect(() => {
    fetchUnread()
    const channel = supabase
      .channel('chat-widget-unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchUnread)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, fetchUnread)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function fetchUnread() {
    const { data } = await supabase.rpc('chat_unread_count')
    setUnread(typeof data === 'number' ? data : 0)
  }

  async function openChat(contact: ChatContact) {
    setPanelOpen(false)
    setSearch('')
    if (windows.some((w) => w.contact.id === contact.id)) return
    const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: contact.id })
    if (error || !convId) {
      toast.error('Could not open chat')
      return
    }
    setWindows((prev) => [...prev, { conversationId: convId as string, contact }].slice(-MAX_WINDOWS))
  }

  function closeWindow(conversationId: string) {
    setWindows((prev) => prev.filter((w) => w.conversationId !== conversationId))
  }

  const filtered = contacts
    .filter((c) => c.full_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)))
  const onlineCount = contacts.filter((c) => online.has(c.id)).length

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

      {/* Online-users panel */}
      {panelOpen && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-50 w-[88vw] sm:w-80 bg-[#0E0B24] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-100">Chat</p>
              <p className="text-[11px] text-green-400">{onlineCount} online</p>
            </div>
            <button onClick={() => setPanelOpen(false)} aria-label="Close" className="p-1 text-slate-500 hover:text-white rounded">
              <X size={16} />
            </button>
          </div>
          <div className="p-3 border-b border-slate-800">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search team members…"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
              />
            </div>
          </div>
          <ul className="list-none m-0 p-0 max-h-80 overflow-y-auto divide-y divide-slate-800/70">
            {filtered.length === 0 ? (
              <li className="text-center text-sm text-slate-500 py-8">No team members found</li>
            ) : filtered.map((c) => {
              const isOnline = online.has(c.id)
              return (
                <li key={c.id}>
                  <button onClick={() => openChat(c)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/60 transition-colors">
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-sm font-bold">
                        {(c.full_name ?? '?').charAt(0).toUpperCase()}
                      </div>
                      <span className={cn(
                        'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-[#0E0B24]',
                        isOnline ? 'bg-green-500' : 'bg-slate-600'
                      )} />
                    </div>
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
