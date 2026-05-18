'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Notification } from '@/types'
import { timeAgo } from '@/lib/utils'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Bell, Check, Info, CheckCircle2, AlertTriangle, XCircle, ArrowUpRight,
} from 'lucide-react'

const TYPE_CONFIG = {
  info:    { icon: Info,          border: 'border-blue-500',   bg: 'bg-blue-500/10',   text: 'text-blue-400'   },
  success: { icon: CheckCircle2,  border: 'border-green-500',  bg: 'bg-green-500/10',  text: 'text-green-400'  },
  warning: { icon: AlertTriangle, border: 'border-yellow-500', bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  error:   { icon: XCircle,       border: 'border-red-500',    bg: 'bg-red-500/10',    text: 'text-red-400'    },
}

const ROLE_BADGE: Record<string, string> = {
  admin:       'bg-orange-500/20 text-orange-400',
  agent:       'bg-blue-500/20 text-blue-400',
  sales_agent: 'bg-purple-500/20 text-purple-400',
  developer:   'bg-cyan-500/20 text-cyan-400',
  client:      'bg-green-500/20 text-green-400',
}

type Filter = 'all' | 'unread'

interface Props {
  initialNotifications: Notification[]
  userId: string
  isAdmin: boolean
}

export function NotificationsClient({ initialNotifications, userId, isAdmin }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications)
  const [filter, setFilter] = useState<Filter>('all')
  const supabase = createClient()

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    const channel = supabase
      .channel('notifications-page')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        // Admins subscribe to all; others only their own
        ...(isAdmin ? {} : { filter: `user_id=eq.${userId}` }),
      }, async (payload) => {
        const newNotif = payload.new as Notification

        // For admin, fetch user info alongside the new notification
        if (isAdmin) {
          const { data } = await supabase
            .from('profiles')
            .select('full_name, role')
            .eq('id', newNotif.user_id)
            .single()
          setNotifications((prev) => [{ ...newNotif, user: data }, ...prev])
        } else {
          setNotifications((prev) => [newNotif, ...prev])
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, isAdmin])

  async function markRead(id: string) {
    const notif = notifications.find((n) => n.id === id)
    // Can only mark own notifications as read
    if (!notif || notif.user_id !== userId) return
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .eq('read', false)
    setNotifications((prev) =>
      prev.map((n) => n.user_id === userId ? { ...n, read: true } : n)
    )
  }

  const displayed = filter === 'unread'
    ? notifications.filter((n) => !n.read)
    : notifications

  return (
    <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {isAdmin ? 'All system notifications' : 'Your recent notifications'}
            {' · '}auto-deleted after 3 days
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
                       bg-orange-500/15 hover:bg-orange-500/25 text-orange-400
                       transition-colors font-medium"
          >
            <Check size={14} />
            Mark all read
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-800 pb-0">
        {(['all', 'unread'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              filter === f
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            )}
          >
            {f}
            {f === 'unread' && unreadCount > 0 && (
              <span className="ml-2 bg-orange-500 text-white text-[10px] font-bold
                               px-1.5 py-0.5 rounded-full">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell size={40} className="text-slate-700 mb-4" />
          <p className="text-slate-400 font-medium">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-slate-600 text-sm mt-1">
            {filter === 'unread'
              ? "You're all caught up!"
              : 'Notifications will appear here as activity happens.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((n) => {
            const cfg = TYPE_CONFIG[n.type]
            const Icon = cfg.icon
            const isOwn = n.user_id === userId

            return (
              <div
                key={n.id}
                className={cn(
                  'relative rounded-xl border-l-4 p-4 transition-all',
                  cfg.border,
                  !n.read && isOwn ? 'bg-slate-800/70' : 'bg-slate-800/30',
                  'border border-slate-700/50'
                )}
              >
                <div className="flex items-start gap-3">
                  {/* Type icon */}
                  <div className={cn('mt-0.5 shrink-0 p-1.5 rounded-lg', cfg.bg)}>
                    <Icon size={14} className={cfg.text} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn(
                        'text-sm font-semibold',
                        !n.read && isOwn ? 'text-white' : 'text-slate-300'
                      )}>
                        {n.title}
                      </p>
                      {!n.read && isOwn && (
                        <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-slate-400 mt-0.5">{n.message}</p>

                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="text-xs text-slate-600">{timeAgo(n.created_at)}</span>

                      {/* Admin: show who the notification belongs to */}
                      {isAdmin && n.user && (
                        <span className={cn(
                          'text-[10px] font-medium px-2 py-0.5 rounded-full capitalize',
                          ROLE_BADGE[n.user.role] ?? 'bg-slate-700 text-slate-400'
                        )}>
                          {n.user.full_name}
                        </span>
                      )}

                      {/* Navigate link */}
                      {n.link && (
                        <Link
                          href={n.link}
                          className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-0.5 transition-colors"
                        >
                          View <ArrowUpRight size={11} />
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Mark as read button (own notifications only) */}
                  {!n.read && isOwn && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Mark as read"
                      className="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                      <Check size={13} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
