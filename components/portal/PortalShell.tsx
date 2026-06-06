'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import Image from 'next/image'
import { Menu } from 'lucide-react'
import { Profile } from '@/types'
import { PortalSidebar } from './PortalSidebar'

interface PortalCtx {
  profile: Profile
  isAdminPreview: boolean
}

const PortalProfileContext = createContext<PortalCtx | null>(null)
export function usePortalProfile() { return useContext(PortalProfileContext) }

interface Props {
  profile: Profile
  isAdminPreview?: boolean
  children: React.ReactNode
}

export function PortalShell({ profile, isAdminPreview = false, children }: Props) {
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <PortalProfileContext.Provider value={{ profile, isAdminPreview }}>
      <div className="flex min-h-screen bg-[#07061A]">
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
          />
        )}
        <PortalSidebar profile={profile} isAdminPreview={isAdminPreview} isOpen={navOpen} onClose={() => setNavOpen(false)} />
        <main className="flex-1 min-w-0">
          {/* Mobile top bar */}
          <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 bg-[#0E0B24] border-b border-slate-800">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="inline-flex items-center justify-center min-w-11 min-h-11 -ml-2 text-slate-400 hover:text-white rounded transition-colors"
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <div className="bg-white rounded-lg px-2.5 py-1">
              <Image src="https://noveliotech.com/logo.png" alt="Novelio" width={96} height={26} className="object-contain" unoptimized />
            </div>
          </div>
          {isAdminPreview && (
            <div className="bg-orange-500/15 border-b border-orange-500/30 px-6 py-2.5
                            flex items-center justify-between">
              <p className="text-orange-300 text-xs font-medium">
                Admin Preview Mode — viewing portal as client
              </p>
              <a
                href="/api/portal-preview"
                className="text-orange-400 hover:text-orange-300 text-xs underline"
              >
                Exit Preview
              </a>
            </div>
          )}
          {children}
        </main>
      </div>
    </PortalProfileContext.Provider>
  )
}
