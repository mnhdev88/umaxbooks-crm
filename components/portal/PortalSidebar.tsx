'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Globe, GitCompare, FileText, LifeBuoy, LayoutDashboard, LogOut, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/types'
import { useEffect, useState } from 'react'

const portalNav = [
  { href: '/portal',               label: 'Overview',       icon: LayoutDashboard },
  { href: '/portal/website',       label: 'My Website',     icon: Globe },
  { href: '/portal/before-after',  label: 'Results',        icon: GitCompare },
  { href: '/portal/contract',      label: 'Contract',       icon: FileText },
  { href: '/portal/support',       label: 'Support',        icon: LifeBuoy },
  { href: '/portal/notifications', label: 'Notifications',  icon: Bell },
]

export function PortalSidebar({ profile, isAdminPreview = false }: { profile: Profile; isAdminPreview?: boolean }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [unreadCount, setUnreadCount] = useState(0)

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
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className="w-60 bg-[#0a1628] border-r border-slate-800 flex flex-col sticky top-0 h-screen shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-800">
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
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700
                          flex items-center justify-center text-white text-xs font-bold shrink-0">
            {profile.full_name.charAt(0).toUpperCase()}
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
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150',
                active
                  ? 'bg-orange-500/15 text-orange-400 font-medium'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              )}
            >
              <Icon size={16} />
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
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm
                     text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
