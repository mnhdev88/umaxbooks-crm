'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, X, Check, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Notification } from '@/types'
import { timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const TYPE_COLORS = {
  info: 'border-blue-500',
  success: 'border-green-500',
  warning: 'border-yellow-500',
  error: 'border-red-500',
}

export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const supabase = createClient()
  const ref = useRef<HTMLDivElement>(null)

  const unread = notifications.filter((n) => !n.read).length

  useEffect(() => {
    fetchNotifications()

    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setNotifications((prev) => [payload.new as Notification, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setNotifications(data)
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-orange-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          aria-modal="true"
          className="absolute right-0 top-12 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-sm font-semibold text-slate-100" id="notif-heading">Notifications</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                aria-label="Mark all notifications as read"
                className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60 rounded"
              >
                <Check size={12} aria-hidden="true" /> Mark all read
              </button>
            )}
          </div>

          <ul aria-label="Notification list" className="max-h-80 overflow-y-auto divide-y divide-slate-800 list-none m-0 p-0">
            {notifications.length === 0 ? (
              <li className="text-sm text-slate-500 text-center py-8">No notifications</li>
            ) : (
              notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'px-4 py-3 border-l-2 transition-colors',
                    !n.read ? 'bg-slate-800/50' : '',
                    TYPE_COLORS[n.type]
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-200">{n.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read && (
                      <button
                        onClick={() => markRead(n.id)}
                        aria-label={`Mark "${n.title}" as read`}
                        className="text-slate-600 hover:text-slate-300 mt-0.5 flex-shrink-0 p-1 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>

          <div className="border-t border-slate-700 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60 rounded"
            >
              See all notifications
              <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
