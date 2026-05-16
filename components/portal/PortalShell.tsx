'use client'

import { createContext, useContext } from 'react'
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
  return (
    <PortalProfileContext.Provider value={{ profile, isAdminPreview }}>
      <div className="flex min-h-screen bg-[#060f1e]">
        <PortalSidebar profile={profile} isAdminPreview={isAdminPreview} />
        <main className="flex-1 min-w-0">
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
