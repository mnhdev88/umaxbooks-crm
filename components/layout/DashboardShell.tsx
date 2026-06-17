'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from './Sidebar'
import { DialerProvider } from '@/components/dialer/DialerProvider'
import { ChatWidget } from '@/components/messages/ChatWidget'
import { OnlineContext } from './presence'
import { Profile } from '@/types'

const ProfileContext = createContext<Profile | null>(null)
export function useProfile() { return useContext(ProfileContext) }

// Presence (online users) lives in ./presence so both DashboardShell and the
// chat components can import it without a circular dependency.
export { useOnlineUsers } from './presence'

const SidebarContext = createContext<{ isOpen: boolean; toggle: () => void; close: () => void }>({
  isOpen: false, toggle: () => {}, close: () => {},
})
export function useSidebar() { return useContext(SidebarContext) }

export function DashboardShell({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
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

  // Presence: announce myself online and track everyone else who's online.
  useEffect(() => {
    const channel = supabase.channel('online-users', {
      config: { presence: { key: userId } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString() })
        }
      })
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  // Last-seen heartbeat: stamp profiles.last_seen_at on load, every 60s, and
  // whenever the tab regains focus. Powers "Last seen X ago" in chat.
  useEffect(() => {
    // .then() is required — the supabase query builder is lazy and won't send
    // the request unless it's awaited/thened.
    const touch = () => { supabase.rpc('touch_last_seen').then(() => {}, () => {}) }
    touch()
    const id = setInterval(touch, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') touch() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [userId])

  // Escape closes the mobile sidebar drawer
  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  if (!profile) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden md:block w-60 min-h-screen bg-[#0E0B24] border-r border-slate-800" />
        <main id="main-content" tabIndex={-1} className="flex-1 flex items-center justify-center">
          <svg className="animate-spin h-7 w-7 text-orange-500" fill="none" viewBox="0 0 24 24" aria-label="Loading" role="status">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </main>
      </div>
    )
  }

  return (
    <ProfileContext.Provider value={profile}>
     <OnlineContext.Provider value={onlineIds}>
      <SidebarContext.Provider value={{
        isOpen: sidebarOpen,
        toggle: () => setSidebarOpen(v => !v),
        close: () => setSidebarOpen(false),
      }}>
        <div className="flex min-h-screen">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60 md:hidden"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <Sidebar profile={profile} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 flex flex-col">
            <DialerProvider>{children}</DialerProvider>
          </main>
          <ChatWidget userId={userId} />
        </div>
      </SidebarContext.Provider>
     </OnlineContext.Provider>
    </ProfileContext.Provider>
  )
}
