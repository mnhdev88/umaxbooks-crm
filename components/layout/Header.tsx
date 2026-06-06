'use client'

import { NotificationBell } from './NotificationBell'
import { Profile } from '@/types'
import { useSidebar } from './DashboardShell'
import { Menu } from 'lucide-react'

interface HeaderProps {
  title: string
  profile: Profile
  actions?: React.ReactNode
}

export function Header({ title, profile, actions }: HeaderProps) {
  const { toggle } = useSidebar()

  return (
    <header className="h-14 bg-[#160E32]/80 backdrop-blur-sm border-b border-slate-800 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="md:hidden inline-flex items-center justify-center min-w-11 min-h-11 -ml-2 text-slate-400 hover:text-white rounded transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <h1 className="text-base font-semibold text-slate-100">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <NotificationBell userId={profile.id} />
      </div>
    </header>
  )
}
