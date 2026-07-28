'use client'

import { useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Notification } from '@/types'
import { cn } from '@/lib/utils'

/** How long a popup stays on screen. */
const DURATION_MS = 10_000

/** localStorage key for the per-user opt-out (same storage approach as theme). */
export const POPUP_PREF_KEY = 'notif_popups'

export function popupsEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(POPUP_PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

const ACCENT: Record<Notification['type'], string> = {
  info:    'border-l-blue-500',
  success: 'border-l-green-500',
  warning: 'border-l-yellow-500',
  error:   'border-l-red-500',
}

/**
 * Shows every incoming notification as a 10-second popup.
 *
 * Subscribes to the same `notifications` INSERT stream the bell uses, so chat
 * messages, inbound SMS, missed calls, approvals and demo events all surface
 * here without a second subscription per source — the DB rows already exist for
 * all of them. Toasting off the `messages` channel as well would double-fire on
 * every DM, since ChatWidget subscribes to that table globally.
 *
 * Deliberately silent when:
 *   - the user turned popups off
 *   - the tab is hidden (web push from the 058 trigger covers that case)
 *   - they're already on the page the notification links to, so an open chat
 *     doesn't toast messages they're actively reading. This is a pathname test
 *     rather than a `read` test on purpose: the 096 trigger marks chat rows read
 *     asynchronously and races the INSERT, so `read` isn't reliable here yet.
 */
export function NotificationToaster({ userId }: { userId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  // Kept in refs so the realtime callback always sees current values without
  // resubscribing on every navigation.
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    const channel = supabase
      .channel('notification-popups')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        const n = payload.new as Notification

        if (!popupsEnabled()) return
        if (seen.current.has(n.id)) return
        if (typeof document !== 'undefined' && document.hidden) return

        // Already looking at it? Say nothing. Compare paths only — a chat link
        // carries a ?c= query the pathname doesn't include, so match the query
        // too when the link has one.
        if (n.link) {
          const [linkPath, linkQuery] = n.link.split('?')
          const here = pathRef.current
          if (linkPath === here) {
            if (!linkQuery) return
            if (typeof window !== 'undefined' && window.location.search.includes(linkQuery.split('&')[0])) return
          }
        }

        seen.current.add(n.id)

        toast.custom((id) => (
          <div
            className={cn(
              'relative w-[356px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-700 border-l-2 bg-[#1e1b4b] shadow-2xl',
              ACCENT[n.type] || ACCENT.info,
            )}
          >
            <div
              role={n.link ? 'button' : undefined}
              tabIndex={n.link ? 0 : undefined}
              onClick={() => {
                if (!n.link) return
                markRead(n.id)
                toast.dismiss(id)
                router.push(n.link)
              }}
              onKeyDown={(e) => {
                if (!n.link) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  markRead(n.id)
                  toast.dismiss(id)
                  router.push(n.link!)
                }
              }}
              className={cn('px-4 py-3 pr-9', n.link && 'cursor-pointer')}
            >
              <p className="text-xs font-semibold text-slate-100">{n.title}</p>
              {n.message && (
                <p className="mt-0.5 text-xs text-slate-400 line-clamp-3">{n.message}</p>
              )}
            </div>

            <button
              onClick={() => toast.dismiss(id)}
              aria-label="Dismiss notification"
              className="absolute right-2 top-2 rounded p-1 text-slate-500 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-orange-500/60"
            >
              <X size={12} aria-hidden="true" />
            </button>

            {/* Countdown — CSS-driven so it costs no re-renders. */}
            <div className="h-0.5 w-full bg-slate-800">
              <div className="notif-countdown h-full bg-orange-500/70" />
            </div>
          </div>
        // unstyled: the card below brings its own background and border, so the
        // global Toaster style would otherwise paint a second one behind it.
        ), { duration: DURATION_MS, unstyled: true })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  async function markRead(id: string) {
    // Best-effort: the bell's UPDATE subscription reflects it either way.
    try {
      await supabase.from('notifications').update({ read: true }).eq('id', id)
    } catch { /* not worth surfacing */ }
  }

  return null
}
