'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Globe, GitCompare, FileText, LifeBuoy, LayoutDashboard, LogOut, Bell, Receipt, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { useEffect, useState } from 'react'

const portalNav = [
  { href: '/portal',               label: 'Overview',       icon: LayoutDashboard },
  { href: '/portal/website',       label: 'My Website',     icon: Globe },
  { href: '/portal/before-after',  label: 'Results',        icon: GitCompare },
  { href: '/portal/contract',      label: 'Contract',       icon: FileText },
  { href: '/portal/invoices',      label: 'Invoices',       icon: Receipt },
  { href: '/portal/support',       label: 'Support',        icon: LifeBuoy },
  { href: '/portal/notifications', label: 'Notifications',  icon: Bell },
]

export function PortalSidebar({ profile, isAdminPreview = false, isOpen = false, onClose }: { profile: Profile; isAdminPreview?: boolean; isOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  const supabase = createClient()
  const [unreadCount, setUnreadCount] = useState(0)
  const [signingOut, setSigningOut]   = useState(false)

  useEffect(() => {
    fetchUnreadCount()
    const channel = supabase
      .channel('portal-sidebar-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, () => {
        fetchUnreadCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.id])

  async function fetchUnreadCount() {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    setUnreadCount(count || 0)
  }

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    await supabase.auth.signOut()
    // Hard navigation — see Sidebar.handleLogout: a soft nav can leak this user's cached
    // RSC payloads to whoever signs in next on the same tab.
    window.location.href = '/login'
  }

  return (
    <aside className={cn(
      'w-60 bg-[#0E0B24] border-r border-slate-800 flex flex-col shrink-0',
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300',
      'lg:sticky lg:top-0 lg:h-screen lg:z-auto lg:translate-x-0 lg:visible lg:pointer-events-auto',
      isOpen ? 'translate-x-0' : '-translate-x-full invisible pointer-events-none'
    )}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
        <div className="bg-white rounded-xl px-3 py-1.5 inline-block">
          <Image
            src="https://noveliotech.com/logo.png"
            alt="Novelio"
            width={120}
            height={32}
            className="object-contain"
            unoptimized
          />
        </div>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="lg:hidden inline-flex items-center justify-center min-w-11 min-h-11 -mr-2 text-slate-500 hover:text-white rounded transition-colors"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700
                          flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(profile.full_name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">{profile.full_name}</p>
            <p className="text-xs text-orange-400">Client Portal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {portalNav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/portal' && pathname.startsWith(href))
          const showBadge = href === '/portal/notifications' && unreadCount > 0
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-all duration-150',
                active
                  ? 'bg-orange-500/15 text-orange-300 font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              )}
            >
              <Icon size={16} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {showBadge && (
                <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 pb-4">
        <button
          onClick={handleLogout}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm
                     text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogOut size={16} aria-hidden="true" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
