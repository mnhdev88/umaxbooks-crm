'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, Code2, BarChart3, Settings, LogOut,
  Activity, MonitorPlay, ClipboardList, Globe, X, Bell, Mail, UserCircle, LifeBuoy, Kanban, MailX, Hammer, Sun, Moon, PhoneCall, UsersRound, Gauge, Briefcase, MessageSquare,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/ThemeProvider'
import { useRouter, useSearchParams } from 'next/navigation'
import { Profile } from '@/types'
import { useEffect, useState } from 'react'

interface NavItem    { href: string; label: string; icon: LucideIcon }
interface NavSection { label?: string; items: NavItem[] }

const agentSections: NavSection[] = [
  { items: [
    { href: '/',               label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/leads',          label: 'All Leads',          icon: Users },
    { href: '/audits',         label: 'Audits & Follow-up', icon: Activity },
    { href: '/ai-calls',       label: 'Calls',           icon: PhoneCall },
    { href: '/email-status',   label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',   label: 'Unsubscribes',       icon: MailX },
    { href: '/reports',        label: 'Reports',            icon: BarChart3 },
    { href: '/messages',       label: 'Messages',           icon: MessageSquare },
    { href: '/notifications',  label: 'Notifications',      icon: Bell },
  ]},
]

const salesAgentSections: NavSection[] = [
  { items: [
    { href: '/',                label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/dashboard',       label: 'Dashboard',          icon: Gauge },
    { href: '/leads',           label: 'All Leads',          icon: Users },
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/ai-calls',        label: 'Calls',           icon: PhoneCall },
    { href: '/email-status',    label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',    label: 'Unsubscribes',       icon: MailX },
    { href: '/support-tickets', label: 'Support Tickets',    icon: LifeBuoy },
    { href: '/reports',         label: 'Reports',            icon: BarChart3 },
    { href: '/messages',        label: 'Messages',           icon: MessageSquare },
    { href: '/notifications',   label: 'Notifications',      icon: Bell },
  ]},
]

const developerSections: NavSection[] = [
  { items: [
    { href: '/developer-pipeline',              label: 'Pipeline',   icon: Kanban },
    { href: '/leads',                           label: 'All Leads',  icon: Users },
    { href: '/developer-queue',                 label: 'Dev Queue',  icon: Code2 },
    { href: '/developer-queue?filter=to-build', label: 'To Build',   icon: Hammer },
    { href: '/messages',                        label: 'Messages',   icon: MessageSquare },
    { href: '/notifications',                   label: 'Notifications', icon: Bell },
  ]},
]

const salesManagerSections: NavSection[] = [
  { items: [
    { href: '/',                label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/dashboard',       label: 'Dashboard',          icon: Gauge },
    { href: '/leads',           label: 'All Leads',          icon: Users },
    { href: '/team',            label: 'My Team',            icon: UsersRound },
    { href: '/team-activity',   label: 'Team Activity',      icon: Activity },
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/ai-calls',        label: 'Calls',           icon: PhoneCall },
    { href: '/email-status',    label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',    label: 'Unsubscribes',       icon: MailX },
    { href: '/support-tickets', label: 'Support Tickets',    icon: LifeBuoy },
    { href: '/reports',         label: 'Reports',            icon: BarChart3 },
    { href: '/messages',        label: 'Messages',           icon: MessageSquare },
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
    { href: '/ai-calls',        label: 'Calls',           icon: PhoneCall },
    { href: '/developer-queue',                 label: 'Dev Queue',  icon: Code2 },
    { href: '/approvals',                       label: 'Approvals',  icon: ClipboardList },
    { href: '/email-status',     label: 'Email Status',      icon: Mail },
    { href: '/unsubscribes',     label: 'Unsubscribes',      icon: MailX },
    { href: '/support-tickets',  label: 'Support Tickets',   icon: LifeBuoy },
  ]},
  { label: 'Analytics', items: [
    { href: '/dashboard', label: 'Dashboard', icon: Gauge },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/team',    label: 'Team',    icon: UsersRound },
    { href: '/team-activity', label: 'Team Activity', icon: Activity },
    { href: '/clients', label: 'Clients', icon: Globe },
    { href: '/careers', label: 'Careers', icon: Briefcase },
  ]},
  { label: 'System', items: [
    { href: '/messages',      label: 'Messages',      icon: MessageSquare },
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
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const supabase = createClient()
  const { theme, toggleTheme } = useTheme()
  const [pendingCount, setPendingCount] = useState(0)
  const [unreadCount, setUnreadCount]   = useState(0)
  const [chatUnread, setChatUnread]     = useState(0)
  const [signingOut, setSigningOut]     = useState(false)

  const sections =
    profile.role === 'admin'         ? adminSections :
    profile.role === 'developer'     ? developerSections :
    profile.role === 'sales_manager' ? salesManagerSections :
    profile.role === 'sales_agent'   ? salesAgentSections :
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

  useEffect(() => {
    fetchChatUnread()
    // messages stream is RLS-filtered to my conversations; refetch on any change
    // (new message in, or my read state advancing on another tab/device).
    const channel = supabase
      .channel('sidebar-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchChatUnread)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, fetchChatUnread)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${profile.id}` }, fetchChatUnread)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.id, pathname])

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

  async function fetchChatUnread() {
    const { data } = await supabase.rpc('chat_unread_count')
    setChatUnread(typeof data === 'number' ? data : 0)
  }

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className={cn(
      'w-56 bg-[#0E0B24] border-r border-slate-800/80 flex flex-col',
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300',
      'md:relative md:translate-x-0 md:z-auto md:min-h-screen md:visible md:pointer-events-auto',
      isOpen ? 'translate-x-0' : '-translate-x-full invisible pointer-events-none'
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
          aria-label="Close menu"
          className="md:hidden text-slate-500 hover:text-white p-2.5 -mr-1.5 rounded transition-colors"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* User chip */}
      <div className="px-4 py-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(profile.full_name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-100 truncate leading-tight">{profile.full_name}</p>
            <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{formatRole(profile.role)}</p>
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
                const [hrefPath, hrefQuery] = href.split('?')
                const hrefParams = hrefQuery ? new URLSearchParams(hrefQuery) : null
                const active = hrefParams
                  ? pathname === hrefPath && searchParams.get('filter') === hrefParams.get('filter')
                  : pathname === href || (href !== '/' && pathname.startsWith(href))
                const badge =
                  href === '/approvals'    && pendingCount > 0 ? pendingCount :
                  href === '/notifications' && unreadCount  > 0 ? unreadCount  :
                  href === '/messages'      && chatUnread   > 0 ? chatUnread   :
                  0
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-all duration-150',
                      active
                        ? 'bg-orange-500/15 text-orange-300 font-medium'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="flex-1 truncate">{label}</span>
                    {badge > 0 && (
                      <span className="bg-orange-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
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

      {/* Bottom: theme + profile + sign out */}
      <div className="px-2.5 py-3 border-t border-slate-800/80 space-y-0.5">
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-all duration-150"
        >
          {theme === 'dark'
            ? <Sun size={15} className="shrink-0" aria-hidden="true" />
            : <Moon size={15} className="shrink-0" aria-hidden="true" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
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
          disabled={signingOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <LogOut size={15} className="shrink-0" />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
