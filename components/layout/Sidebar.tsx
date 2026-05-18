'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, Code2, BarChart3, Settings, LogOut,
  Activity, MonitorPlay, ClipboardList, Globe, X, Bell, Mail, UserCircle, LifeBuoy,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Profile } from '@/types'
import { useEffect, useState } from 'react'

interface NavItem    { href: string; label: string; icon: LucideIcon }
interface NavSection { label?: string; items: NavItem[] }

const agentSections: NavSection[] = [
  { items: [
    { href: '/',              label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/leads',         label: 'All Leads',          icon: Users },
    { href: '/audits',        label: 'Audits & Follow-up', icon: Activity },
    { href: '/email-status',  label: 'Email Status',       icon: Mail },
    { href: '/reports',       label: 'Reports',            icon: BarChart3 },
    { href: '/notifications', label: 'Notifications',      icon: Bell },
  ]},
]

const salesAgentSections: NavSection[] = [
  { items: [
    { href: '/',              label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/leads',         label: 'All Leads',          icon: Users },
    { href: '/audits',        label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',    label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/email-status',  label: 'Email Status',       icon: Mail },
    { href: '/support-tickets', label: 'Support Tickets', icon: LifeBuoy },
    { href: '/reports',       label: 'Reports',            icon: BarChart3 },
    { href: '/notifications', label: 'Notifications',      icon: Bell },
  ]},
]

const developerSections: NavSection[] = [
  { items: [
    { href: '/',                label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/leads',           label: 'All Leads',          icon: Users },
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/developer-queue', label: 'Dev Queue',          icon: Code2 },
    { href: '/email-status',    label: 'Email Status',       icon: Mail },
    { href: '/notifications',   label: 'Notifications',      icon: Bell },
  ]},
]

const adminSections: NavSection[] = [
  { items: [
    { href: '/',    label: 'Pipeline',  icon: LayoutDashboard },
    { href: '/leads', label: 'All Leads', icon: Users },
  ]},
  { label: 'Workflow', items: [
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/developer-queue', label: 'Dev Queue',          icon: Code2 },
    { href: '/approvals',        label: 'Approvals',         icon: ClipboardList },
    { href: '/email-status',     label: 'Email Status',      icon: Mail },
    { href: '/support-tickets',  label: 'Support Tickets',   icon: LifeBuoy },
  ]},
  { label: 'Analytics', items: [
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/clients', label: 'Clients', icon: Globe },
  ]},
  { label: 'System', items: [
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/settings',      label: 'Settings',      icon: Settings },
  ]},
]

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

interface SidebarProps {
  profile: Profile
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ profile, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createClient()
  const [pendingCount, setPendingCount] = useState(0)
  const [unreadCount, setUnreadCount]   = useState(0)

  const sections =
    profile.role === 'admin'       ? adminSections :
    profile.role === 'developer'   ? developerSections :
    profile.role === 'sales_agent' ? salesAgentSections :
    agentSections

  useEffect(() => {
    if (profile.role !== 'admin') return
    fetchPendingCount()
    const id = setInterval(fetchPendingCount, 30000)
    return () => clearInterval(id)
  }, [profile.role])

  useEffect(() => {
    fetchUnreadCount()
    const channel = supabase
      .channel('sidebar-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` }, () => {
        fetchUnreadCount()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.id])

  async function fetchPendingCount() {
    const { count } = await supabase
      .from('project_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    setPendingCount(count || 0)
  }

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
    <aside className={cn(
      'w-56 bg-[#0a1628] border-r border-slate-800/80 flex flex-col',
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300',
      'md:relative md:translate-x-0 md:z-auto md:min-h-screen',
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>

      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-800/80 flex items-center justify-between">
        <div className="bg-white rounded-lg px-2.5 py-1">
          <Image
            src="https://noveliotech.com/logo.png"
            alt="Novelio"
            width={110}
            height={28}
            className="object-contain"
            unoptimized
          />
        </div>
        <button
          onClick={onClose}
          className="md:hidden text-slate-500 hover:text-white p-1 rounded transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* User chip */}
      <div className="px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-100 truncate leading-tight">{profile.full_name}</p>
            <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{formatRole(profile.role)}</p>
          </div>
        </div>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 scrollbar-hide">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || (href !== '/' && pathname.startsWith(href))
                const badge =
                  href === '/approvals'    && pendingCount > 0 ? pendingCount :
                  href === '/notifications' && unreadCount  > 0 ? unreadCount  :
                  0
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150',
                      active
                        ? 'bg-orange-500/15 text-orange-400 font-medium'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                    {badge > 0 && (
                      <span className="bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: profile + sign out */}
      <div className="px-2.5 py-3 border-t border-slate-800/80 space-y-0.5">
        <Link
          href="/profile"
          onClick={onClose}
          className={cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150',
            pathname === '/profile'
              ? 'bg-orange-500/15 text-orange-400 font-medium'
              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
          )}
        >
          <UserCircle size={15} className="shrink-0" />
          My Profile
        </Link>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150"
        >
          <LogOut size={15} className="shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
