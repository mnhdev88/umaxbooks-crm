'use client'

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react'

/** What the user picked. 'system' follows the OS light/dark setting live. */
export type ThemePreference = 'system' | 'light' | 'dark'
/** What is actually on screen. */
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
const CHANGE_EVENT = 'theme-preference-change'
const ORDER: ThemePreference[] = ['system', 'light', 'dark']
const LIGHT_QUERY = '(prefers-color-scheme: light)'

const ThemeContext = createContext<{
  /** Resolved theme currently applied — use this for rendering decisions. */
  theme: ResolvedTheme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** Cycles System → Light → Dark. */
  cycleTheme: () => void
}>({
  theme: 'dark',
  preference: 'system',
  setPreference: () => {},
  cycleTheme: () => {},
})

export function useTheme() { return useContext(ThemeContext) }

// ── Saved preference (localStorage; synced across tabs via 'storage') ──────
function subscribePreference(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(CHANGE_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(CHANGE_EVENT, cb)
  }
}
function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {}
  return 'system'
}

// ── OS colour scheme (live, e.g. Windows/macOS auto dark mode at sunset) ───
function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia(LIGHT_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function readSystem(): ResolvedTheme {
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server snapshots are placeholders; the inline script in the root layout
  // has already painted the right theme class before hydration, so no flash.
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => 'system' as const)
  const system = useSyncExternalStore(subscribeSystem, readSystem, () => 'dark' as const)
  const theme: ResolvedTheme = preference === 'system' ? system : preference

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const setPreference = useCallback((p: ThemePreference) => {
    try { localStorage.setItem(STORAGE_KEY, p) } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const cycleTheme = useCallback(() => {
    setPreference(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length])
  }, [preference, setPreference])

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
