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

/** Accent colour choices. Palettes live in app/globals.css (html[data-accent]). */
export const ACCENTS = [
  { id: 'violet',  label: 'Violet',  swatch: '#6E66E0' },
  { id: 'blue',    label: 'Blue',    swatch: '#2563EB' },
  { id: 'teal',    label: 'Teal',    swatch: '#0F766E' },
  { id: 'emerald', label: 'Emerald', swatch: '#047857' },
  { id: 'fuchsia', label: 'Fuchsia', swatch: '#A21CAF' },
  { id: 'sunset',  label: 'Sunset',  swatch: '#C2410C' },
] as const
export type Accent = (typeof ACCENTS)[number]['id']
const DEFAULT_ACCENT: Accent = 'violet'
const ACCENT_KEY = 'accent'
const isAccent = (v: unknown): v is Accent => ACCENTS.some(a => a.id === v)

const ThemeContext = createContext<{
  /** Resolved theme currently applied — use this for rendering decisions. */
  theme: ResolvedTheme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** Cycles System → Light → Dark. */
  cycleTheme: () => void
  accent: Accent
  setAccent: (a: Accent) => void
}>({
  theme: 'dark',
  preference: 'system',
  setPreference: () => {},
  cycleTheme: () => {},
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
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

function readAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY)
    if (isAccent(v)) return v
  } catch {}
  return DEFAULT_ACCENT
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
  // Same storage + change event as the theme, so tabs stay in sync.
  const accent = useSyncExternalStore(subscribePreference, readAccent, () => DEFAULT_ACCENT)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    // Violet is the base palette in :root, so it needs no attribute.
    const root = document.documentElement
    if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent')
    else root.setAttribute('data-accent', accent)
  }, [accent])

  const setAccent = useCallback((a: Accent) => {
    try { localStorage.setItem(ACCENT_KEY, a) } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const setPreference = useCallback((p: ThemePreference) => {
    try { localStorage.setItem(STORAGE_KEY, p) } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const cycleTheme = useCallback(() => {
    setPreference(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length])
  }, [preference, setPreference])

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, cycleTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  )
}
