'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from './Sidebar'
import { Profile } from '@/types'

const ProfileContext = createContext<Profile | null>(null)
export function useProfile() { return useContext(ProfileContext) }

const SidebarContext = createContext<{ isOpen: boolean; toggle: () => void; close: () => void }>({
  isOpen: false, toggle: () => {}, close: () => {},
})
export function useSidebar() { return useContext(SidebarContext) }

export function DashboardShell({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { router.push('/login'); return }
        setProfile(data as Profile)
      })
  }, [userId])

  if (!profile) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden md:block w-60 min-h-screen bg-[#0a1628] border-r border-slate-800" />
        <main className="flex-1 flex items-center justify-center">
          <svg className="animate-spin h-7 w-7 text-orange-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </main>
      </div>
    )
  }

  return (
    <ProfileContext.Provider value={profile}>
      <SidebarContext.Provider value={{
        isOpen: sidebarOpen,
        toggle: () => setSidebarOpen(v => !v),
        close: () => setSidebarOpen(false),
      }}>
        <div className="flex min-h-screen">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <Sidebar profile={profile} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 min-w-0 flex flex-col">{children}</main>
        </div>
      </SidebarContext.Provider>
    </ProfileContext.Provider>
  )
}
