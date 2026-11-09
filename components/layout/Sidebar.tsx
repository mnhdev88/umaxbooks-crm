'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, Code2, BarChart3, Settings, LogOut,
  Activity, MonitorPlay, ClipboardList, Globe, X, Bell, Mail, UserCircle, LifeBuoy, Kanban, MailX, Hammer, Sun, Moon, Monitor, ChevronDown, PhoneCall, UsersRound, Gauge, Briefcase, MessageSquare, MessageCircle, CalendarDays, Images, MessageSquarePlus, FileSignature, Inbox, Search,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/components/ThemeProvider'
import { usePoll } from '@/lib/use-poll'
import { EMAIL_UNREAD_EVENT } from '@/lib/email-events'
import { RingVolumeControl } from '@/components/dialer/RingVolumeControl'
import { useSearchParams } from 'next/navigation'
import { Profile } from '@/types'
import { useEffect, useRef, useState } from 'react'

const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' } as const
const NEXT_THEME = { system: 'light', light: 'dark', dark: 'system' } as const

interface NavItem    { href: string; label: string; icon: LucideIcon }
// collapsible sections start closed (state remembered per browser) and open
// automatically while you're on one of their pages.
interface NavSection { label?: string; items: NavItem[]; collapsible?: boolean }

// Order: what agents use every day first; occasional pages grouped below.
const agentSections: NavSection[] = [
  { items: [
    { href: '/',               label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/leads',          label: 'All Leads',          icon: Users },
    { href: '/calendar',       label: 'Calendar',           icon: CalendarDays },
    { href: '/ai-calls',       label: 'Calls',              icon: PhoneCall },
    { href: '/sms',            label: 'SMS',                icon: MessageCircle },
    { href: '/emails',         label: 'Emails',             icon: Inbox },
    { href: '/audits',         label: 'Audits & Follow-up', icon: Activity },
    { href: '/messages',       label: 'Messages',           icon: MessageSquare },
    { href: '/notifications',  label: 'Notifications',      icon: Bell },
  ]},
  { label: 'More', collapsible: true, items: [
    { href: '/reports',        label: 'Reports',            icon: BarChart3 },
    { href: '/email-status',   label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',   label: 'Unsubscribes',       icon: MailX },
    { href: '/settings',       label: 'Settings',           icon: Settings },
  ]},
]

const salesAgentSections: NavSection[] = [
  { items: [
    { href: '/',                label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/dashboard',       label: 'Dashboard',          icon: Gauge },
    { href: '/leads',           label: 'All Leads',          icon: Users },
    { href: '/calendar',        label: 'Calendar',           icon: CalendarDays },
    { href: '/ai-calls',        label: 'Calls',              icon: PhoneCall },
    { href: '/sms',             label: 'SMS',                icon: MessageCircle },
    { href: '/emails',          label: 'Emails',             icon: Inbox },
    { href: '/messages',        label: 'Messages',           icon: MessageSquare },
    { href: '/notifications',   label: 'Notifications',      icon: Bell },
  ]},
  { label: 'Sales', items: [
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/demos',           label: 'Demos',              icon: Images },
    { href: '/contracts',       label: 'Contracts',          icon: FileSignature },
  ]},
  { label: 'More', collapsible: true, items: [
    { href: '/reports',         label: 'Reports',            icon: BarChart3 },
    { href: '/support-tickets', label: 'Support Tickets',    icon: LifeBuoy },
    { href: '/email-status',    label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',    label: 'Unsubscribes',       icon: MailX },
    { href: '/settings',        label: 'Settings',           icon: Settings },
  ]},
]

const developerSections: NavSection[] = [
  { items: [
    { href: '/developer-pipeline',              label: 'Pipeline',   icon: Kanban },
    { href: '/leads',                           label: 'All Leads',  icon: Users },
    { href: '/developer-queue',                 label: 'Dev Queue',  icon: Code2 },
    { href: '/developer-queue?filter=to-build', label: 'To Build',   icon: Hammer },
    { href: '/demos',                           label: 'Demos',      icon: Images },
    { href: '/messages',                        label: 'Messages',   icon: MessageSquare },
    { href: '/notifications',                   label: 'Notifications', icon: Bell },
    { href: '/settings',                        label: 'Settings',   icon: Settings },
  ]},
]

// The SEO agent works post-sale only: live client sites, their issue queue, and
// the monthly report. Deliberately no Pipeline / Calls / Approvals / revenue
// Reports — none of it is theirs, and hiding it keeps the role honest.
const seoAgentSections: NavSection[] = [
  { items: [
    { href: '/seo',           label: 'Site Health',   icon: Gauge },
    { href: '/seo/reports',   label: 'Client Reports', icon: BarChart3 },
    { href: '/messages',      label: 'Messages',      icon: MessageSquare },
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/settings',      label: 'Settings',      icon: Settings },
  ]},
]

const salesManagerSections: NavSection[] = [
  { items: [
    { href: '/',                label: 'Pipeline',           icon: LayoutDashboard },
    { href: '/dashboard',       label: 'Dashboard',          icon: Gauge },
    { href: '/leads',           label: 'All Leads',          icon: Users },
    { href: '/calendar',        label: 'Calendar',           icon: CalendarDays },
    { href: '/ai-calls',        label: 'Calls',              icon: PhoneCall },
    { href: '/sms',             label: 'SMS',                icon: MessageCircle },
    { href: '/emails',          label: 'Emails',             icon: Inbox },
    { href: '/messages',        label: 'Messages',           icon: MessageSquare },
    { href: '/notifications',   label: 'Notifications',      icon: Bell },
  ]},
  { label: 'Sales', items: [
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/demos',           label: 'Demos',              icon: Images },
    { href: '/contracts',       label: 'Contracts',          icon: FileSignature },
  ]},
  { label: 'Team', items: [
    { href: '/team',            label: 'My Team',            icon: UsersRound },
    { href: '/team-activity',   label: 'Team Activity',      icon: Activity },
    { href: '/approvals',       label: 'Approvals',          icon: ClipboardList },
    { href: '/note-approvals',  label: 'Note Approvals',     icon: MessageSquarePlus },
    { href: '/reports',         label: 'Reports',            icon: BarChart3 },
  ]},
  { label: 'More', collapsible: true, items: [
    { href: '/support-tickets', label: 'Support Tickets',    icon: LifeBuoy },
    { href: '/email-status',    label: 'Email Status',       icon: Mail },
    { href: '/unsubscribes',    label: 'Unsubscribes',       icon: MailX },
    { href: '/settings',        label: 'Settings',           icon: Settings },
  ]},
]

const adminSections: NavSection[] = [
  { items: [
    { href: '/',              label: 'Pipeline',      icon: LayoutDashboard },
    { href: '/leads',         label: 'All Leads',     icon: Users },
    { href: '/calendar',      label: 'Calendar',      icon: CalendarDays },
    { href: '/ai-calls',      label: 'Calls',         icon: PhoneCall },
    { href: '/sms',           label: 'SMS',           icon: MessageCircle },
    { href: '/emails',        label: 'Emails',        icon: Inbox },
    { href: '/messages',      label: 'Messages',      icon: MessageSquare },
    { href: '/notifications', label: 'Notifications', icon: Bell },
  ]},
  { label: 'Sales', items: [
    { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
    { href: '/demo-close',      label: 'Demo & Close',       icon: MonitorPlay },
    { href: '/demos',           label: 'Demos',              icon: Images },
    { href: '/contracts',       label: 'Contracts',          icon: FileSignature },
  ]},
  { label: 'Review', items: [
    { href: '/approvals',       label: 'Approvals',          icon: ClipboardList },
    { href: '/note-approvals',  label: 'Note Approvals',     icon: MessageSquarePlus },
    { href: '/developer-queue', label: 'Dev Queue',          icon: Code2 },
    { href: '/support-tickets', label: 'Support Tickets',    icon: LifeBuoy },
  ]},
  { label: 'Analytics', collapsible: true, items: [
    { href: '/dashboard',     label: 'Dashboard',     icon: Gauge },
    { href: '/reports',       label: 'Reports',       icon: BarChart3 },
    { href: '/team',          label: 'Team',          icon: UsersRound },
    { href: '/team-activity', label: 'Team Activity', icon: Activity },
    { href: '/clients',       label: 'Clients',       icon: Globe },
    { href: '/seo',           label: 'SEO Health',    icon: Gauge },
    { href: '/careers',       label: 'Careers',       icon: Briefcase },
  ]},
  { label: 'Admin', collapsible: true, items: [
    { href: '/email-status',  label: 'Email Status',  icon: Mail },
    { href: '/unsubscribes',  label: 'Unsubscribes',  icon: MailX },
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
  const supabase = createClient()
  const { preference, cycleTheme } = useTheme()
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingNotes, setPendingNotes] = useState(0)
  const [unreadCount, setUnreadCount]   = useState(0)
  const [chatUnread, setChatUnread]     = useState(0)
  const [emailUnread, setEmailUnread]   = useState(0)
  const [signingOut, setSigningOut]     = useState(false)
  const router = useRouter()

  // Quick filter over the nav. Searches every section, collapsed ones included,
  // so "unsub" finds Unsubscribes even while "More" is closed.
  const [query, setQuery]         = useState('')
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  // "/" focuses the filter from anywhere (unless you're already typing somewhere).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const el = searchRef.current
      if (!el || el.offsetParent === null) return // sidebar hidden (closed on mobile)
      e.preventDefault()
      el.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Which collapsible sections the user has opened (remembered per browser).
  // The sidebar only mounts client-side (after the profile loads), so reading
  // localStorage in the initializer can't cause a hydration mismatch.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('sidebar-open-sections') || '{}') } catch { return {} }
  })
  function toggleSection(label: string) {
    setOpenSections(prev => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem('sidebar-open-sections', JSON.stringify(next)) } catch {}
      return next
    })
  }

  const sections =
    profile.role === 'admin'         ? adminSections :
    profile.role === 'developer'     ? developerSections :
    profile.role === 'seo_agent'     ? seoAgentSections :
    profile.role === 'sales_manager' ? salesManagerSections :
    profile.role === 'sales_agent'   ? salesAgentSections :
    agentSections

  // Admins act on approvals; sales managers see them read-only. Both get the badge.
  const showsApprovalBadges = profile.role === 'admin' || profile.role === 'sales_manager'

  useEffect(() => {
    if (!showsApprovalBadges) return
    fetchPendingCount()
    fetchPendingNotes()
  }, [showsApprovalBadges])

  // Two requests per tick, and the sidebar is mounted on every dashboard page in
  // every open tab — so this ran regardless of whether anyone was looking at the
  // badge. Paused while hidden, caught up on refocus. See lib/use-poll.
  // 2 min (was 30s): approvals aren't time-critical, and these are count queries
  // run by every admin/manager tab.
  usePoll(() => { fetchPendingCount(); fetchPendingNotes() }, 120_000, showsApprovalBadges)

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
    // NB: intentionally NOT keyed on pathname — the read-state UPDATE subscription
    // above already refreshes the badge, so re-subscribing on every navigation
    // just churned Realtime channels (and WAL decode load) for no benefit.
  }, [profile.id])

  async function fetchPendingCount() {
    const { count } = await supabase
      .from('project_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    setPendingCount(count || 0)
  }

  // Agent audit notes waiting on a sales-manager review.
  async function fetchPendingNotes() {
    const { count } = await supabase
      .from('audit_notes')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending')
    setPendingNotes(count || 0)
  }

  async function fetchUnreadCount() {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id)
      .eq('read', false)
    setUnreadCount(count || 0)
  }

  // Lead email conversations with unread replies (Emails inbox). Replies arrive via the
  // 5-min Gmail sync, so a 60s poll is plenty; the inbox fires an event on read/sync.
  const showsEmailBadge = sections.some(sec => sec.items.some(i => i.href === '/emails'))
  usePoll(() => { fetchEmailUnread() }, 60_000, showsEmailBadge)
  useEffect(() => {
    if (!showsEmailBadge) return
    fetchEmailUnread()
    const onChange = () => { fetchEmailUnread() }
    window.addEventListener(EMAIL_UNREAD_EVENT, onChange)
    return () => window.removeEventListener(EMAIL_UNREAD_EVENT, onChange)
  }, [showsEmailBadge])

  async function fetchEmailUnread() {
    const { data } = await supabase.rpc('email_unread_count')
    setEmailUnread(typeof data === 'number' ? data : 0)
  }

  async function fetchChatUnread() {
    const { data } = await supabase.rpc('chat_unread_count')
    setChatUnread(typeof data === 'number' ? data : 0)
  }

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    await supabase.auth.signOut()
    // Hard navigation, not router.push: a soft nav leaves Next's router cache holding this
    // user's rendered payloads, so the next person to sign in on this tab can be handed
    // their `userId`/`role` props. That desync is what broke chat sends (RLS 42501).
    window.location.href = '/login'
  }

  const sectionRows = sections.map(section => {
    const rows = section.items.map(item => {
      const [hrefPath, hrefQuery] = item.href.split('?')
      const hrefParams = hrefQuery ? new URLSearchParams(hrefQuery) : null
      const active = hrefParams
        ? pathname === hrefPath && searchParams.get('filter') === hrefParams.get('filter')
        : pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
      const badge =
        item.href === '/approvals'      && pendingCount > 0 ? pendingCount :
        item.href === '/note-approvals' && pendingNotes > 0 ? pendingNotes :
        item.href === '/notifications'  && unreadCount  > 0 ? unreadCount  :
        item.href === '/messages'       && chatUnread   > 0 ? chatUnread   :
        item.href === '/emails'         && emailUnread  > 0 ? emailUnread  :
        0
      return { ...item, active, badge, section: section.label }
    })
    return { section, rows }
  })

  // Label matches first (prefix, then word-start, then anywhere), then section-name matches.
  const q = query.trim().toLowerCase()
  const matches = q
    ? sectionRows
        .flatMap(s => s.rows)
        .map(r => {
          const l = r.label.toLowerCase()
          const score =
            l.startsWith(q) ? 0 :
            l.split(/[\s&-]+/).some(w => w.startsWith(q)) ? 1 :
            l.includes(q) ? 2 :
            r.section?.toLowerCase().includes(q) ? 3 : -1
          return { r, score }
        })
        .filter(m => m.score >= 0)
        .sort((a, b) => a.score - b.score)
        .map(m => m.r)
    : []
  const hl = Math.min(highlight, Math.max(matches.length - 1, 0))

  function clearSearch() {
    setQuery('')
    setHighlight(0)
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && matches.length) {
      e.preventDefault()
      setHighlight((hl + 1) % matches.length)
    } else if (e.key === 'ArrowUp' && matches.length) {
      e.preventDefault()
      setHighlight((hl - 1 + matches.length) % matches.length)
    } else if (e.key === 'Enter' && matches[hl]) {
      e.preventDefault()
      router.push(matches[hl].href)
      clearSearch()
      e.currentTarget.blur()
      onClose()
    } else if (e.key === 'Escape') {
      clearSearch()
      e.currentTarget.blur()
    }
  }

  function renderRow(
    { href, label, icon: Icon, active, badge, section }: (typeof sectionRows)[number]['rows'][number],
    opts?: { highlighted?: boolean; showSection?: boolean },
  ) {
    return (
      <Link
        key={href}
        href={href}
        onClick={() => { clearSearch(); onClose() }}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors duration-150',
          active
            ? 'bg-orange-500/15 text-orange-300 font-medium'
            : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70',
          opts?.highlighted && !active && 'bg-slate-800/70 text-slate-100',
          opts?.highlighted && 'ring-1 ring-orange-500/40',
        )}
      >
        <Icon size={15} className="shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        {opts?.showSection && section && (
          <span className="text-[10px] text-slate-500 shrink-0">{section}</span>
        )}
        {badge > 0 && (
          <span className="bg-orange-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <aside className={cn(
      'w-56 bg-surface border-r border-slate-800/80 flex flex-col',
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300',
      // Desktop: pinned to the viewport while the page scrolls. Exactly one
      // screen tall, so the nav list scrolls inside it if it overflows.
      'md:sticky md:top-0 md:h-dvh md:shrink-0 md:self-start md:translate-x-0 md:z-30 md:visible md:pointer-events-auto',
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
          {/* Ring volume lives here rather than only on the incoming-call popup —
              a call gives you ~15 seconds, which is no time to go looking. */}
          <div className="ml-auto flex items-center gap-0.5">
            {/* Theme: cycles System → Light → Dark; icon shows the current choice */}
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Theme: ${THEME_LABEL[preference]}. Switch to ${THEME_LABEL[NEXT_THEME[preference]]}`}
              title={`Theme: ${THEME_LABEL[preference]} (click for ${THEME_LABEL[NEXT_THEME[preference]].toLowerCase()})`}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {preference === 'system'
                ? <Monitor size={15} aria-hidden="true" />
                : preference === 'light'
                  ? <Sun size={15} aria-hidden="true" />
                  : <Moon size={15} aria-hidden="true" />}
            </button>
            <RingVolumeControl />
          </div>
        </div>
      </div>

      {/* Quick filter */}
      <div className="px-2.5 pt-3">
        <div className="relative">
          <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlight(0) }}
            onKeyDown={onSearchKey}
            placeholder="Search pages…"
            aria-label="Search pages"
            aria-controls="sidebar-nav"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-slate-900/60 border border-slate-800 rounded-lg pl-8 pr-7 py-1.5 text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/30 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { clearSearch(); searchRef.current?.focus() }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-500 hover:text-slate-200"
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="hidden md:block absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-slate-700 rounded px-1 leading-4 pointer-events-none">/</kbd>
          )}
        </div>
      </div>

      {/* Nav sections */}
      <nav id="sidebar-nav" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 scrollbar-hide">
        {q ? (
          matches.length ? (
            <div className="space-y-0.5">
              {matches.map((r, i) => renderRow(r, { highlighted: i === hl, showSection: true }))}
            </div>
          ) : (
            <p className="px-2.5 py-2 text-[12px] text-slate-500">No pages match “{query.trim()}”</p>
          )
        ) : sectionRows.map(({ section, rows }, si) => {
          const hasActive = rows.some(r => r.active)
          const open = !section.collapsible || hasActive || !!openSections[section.label ?? '']
          const hiddenBadges = open ? 0 : rows.reduce((n, r) => n + r.badge, 0)

          return (
            <div key={si}>
              {section.label && (section.collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleSection(section.label!)}
                  aria-expanded={open}
                  disabled={hasActive}
                  className="w-full flex items-center gap-1 px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-slate-500"
                >
                  <span className="flex-1 text-left">{section.label}</span>
                  {hiddenBadges > 0 && (
                    <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none normal-case tracking-normal">
                      {hiddenBadges > 99 ? '99+' : hiddenBadges}
                    </span>
                  )}
                  <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform duration-200', !open && '-rotate-90')} />
                </button>
              ) : (
                <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {section.label}
                </p>
              ))}
              {open && (
                <div className="space-y-0.5">
                  {rows.map(r => renderRow(r))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Bottom: profile + sign out (theme toggle lives in the user chip) */}
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
