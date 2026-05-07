'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Code2,
  BarChart3,
  Settings,
  LogOut,
  Zap,
  Activity,
  MonitorPlay,
  ClipboardList,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Profile } from '@/types'
import { useEffect, useState } from 'react'

const agentNav = [
  { href: '/',        label: 'Pipeline',          icon: LayoutDashboard },
  { href: '/leads',   label: 'All Leads',          icon: Users },
  { href: '/audits',  label: 'Audits & Follow-up', icon: Activity },
  { href: '/reports', label: 'Reports',            icon: BarChart3 },
]

const salesAgentNav = [
  { href: '/',             label: 'Pipeline',          icon: LayoutDashboard },
  { href: '/leads',        label: 'All Leads',          icon: Users },
  { href: '/audits',       label: 'Audits & Follow-up', icon: Activity },
  { href: '/demo-close',   label: 'Demo & Close',       icon: MonitorPlay },
  { href: '/reports',      label: 'Reports',            icon: BarChart3 },
]

const developerNav = [
  { href: '/developer-queue', label: 'Dev Queue', icon: Code2 },
]

const adminNav = [
  { href: '/',                label: 'Pipeline',          icon: LayoutDashboard },
  { href: '/leads',           label: 'All Leads',         icon: Users },
  { href: '/audits',          label: 'Audits & Follow-up', icon: Activity },
  { href: '/demo-close',      label: 'Demo & Close',      icon: MonitorPlay },
  { href: '/developer-queue', label: 'Dev Queue',         icon: Code2 },
  { href: '/approvals',       label: 'Approvals',         icon: ClipboardList },
  { href: '/reports',         label: 'Reports',           icon: BarChart3 },
  { href: '/settings',        label: 'Settings',          icon: Settings },
]

interface SidebarProps {
  profile: Profile
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ profile, isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [pendingCount, setPendingCount] = useState(0)

  const nav =
    profile.role === 'admin'       ? adminNav :
    profile.role === 'developer'   ? developerNav :
    profile.role === 'sales_agent' ? salesAgentNav :
    agentNav

  useEffect(() => {
    if (profile.role !== 'admin') return
    fetchPendingCount()
    const id = setInterval(fetchPendingCount, 30000)
    return () => clearInterval(id)
  }, [profile.role])

  async function fetchPendingCount() {
    const { count } = await supabase
      .from('project_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    setPendingCount(count || 0)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <aside className={cn(
      'w-60 bg-[#0a1628] border-r border-slate-800 flex flex-col',
      'fixed inset-y-0 left-0 z-50 transition-transform duration-300',
      'md:relative md:translate-x-0 md:z-auto md:min-h-screen',
      isOpen ? 'translate-x-0' : '-translate-x-full'
    )}>
      {/* Logo + close button */}
      <div className="px-5 py-5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-white tracking-tight">UMAX CRM</span>
        </div>
        <button
          onClick={onClose}
          className="md:hidden text-slate-400 hover:text-white p-1 rounded transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* User info */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold">
            {profile.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">{profile.full_name}</p>
            <p className="text-xs text-slate-500 capitalize">{profile.role}</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          const showBadge = href === '/approvals' && pendingCount > 0
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
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
                  {pendingCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-4">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-all duration-150"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  )
}
