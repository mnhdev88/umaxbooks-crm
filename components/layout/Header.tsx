'use client'

import { NotificationBell } from './NotificationBell'
import { Profile } from '@/types'

interface HeaderProps {
  title: string
  profile: Profile
  actions?: React.ReactNode
}

export function Header({ title, profile, actions }: HeaderProps) {
  return (
    <header className="h-14 bg-[#0d1f3c]/80 backdrop-blur-sm border-b border-slate-800 flex items-center justify-between px-6 sticky top-0 z-30">
      <h1 className="text-base font-semibold text-slate-100">{title}</h1>
      <div className="flex items-center gap-3">
        {actions}
        <NotificationBell userId={profile.id} />
      </div>
    </header>
  )
}
