'use client'

import { NotificationBell } from './NotificationBell'
import { Profile } from '@/types'
import { useSidebar } from './DashboardShell'
import { useTheme } from '@/components/ThemeProvider'
import { Menu, Sun, Moon } from 'lucide-react'

interface HeaderProps {
  title: string
  profile: Profile
  actions?: React.ReactNode
}

export function Header({ title, profile, actions }: HeaderProps) {
  const { toggle } = useSidebar()
  const { theme, toggleTheme } = useTheme()

  return (
    <header className="h-14 bg-[#0d1f3c]/80 backdrop-blur-sm border-b border-slate-800 flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="md:hidden text-slate-400 hover:text-white p-1 rounded transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base font-semibold text-slate-100">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <NotificationBell userId={profile.id} />
      </div>
    </header>
  )
}
