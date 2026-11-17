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

/** Background themes. Greys/surfaces live in app/globals.css (html[data-palette]).
 *  `dark`/`light` are swatch colours; `accent` is applied when the theme is picked
 *  (the user can still change the accent afterwards). */
export const PALETTES = [
  { id: 'navy',     label: 'Navy',     dark: '#141B2D', light: '#ECEEF4', accent: 'violet'  },
  { id: 'charcoal', label: 'Charcoal', dark: '#1B1B1F', light: '#EEEEEF', accent: 'blue'    },
  { id: 'midnight', label: 'Midnight', dark: '#080A10', light: '#EEEEEF', accent: 'violet'  },
  { id: 'forest',   label: 'Forest',   dark: '#0F2017', light: '#EBEFED', accent: 'emerald' },
  { id: 'plum',     label: 'Plum',     dark: '#231625', light: '#F0EDF1', accent: 'fuchsia' },
] as const satisfies readonly { id: string; label: string; dark: string; light: string; accent: Accent }[]
export type Palette = (typeof PALETTES)[number]['id']
const DEFAULT_PALETTE: Palette = 'navy'
const PALETTE_KEY = 'palette'
const isPalette = (v: unknown): v is Palette => PALETTES.some(p => p.id === v)

/** 3D depth (shadows, bevels, hover lift, tilt) — on unless the user turns it off. */
const DEPTH_KEY = 'depth'
const TILT_MAX_DEG = 4

const ThemeContext = createContext<{
  /** Resolved theme currently applied — use this for rendering decisions. */
  theme: ResolvedTheme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** Cycles System → Light → Dark. */
  cycleTheme: () => void
  accent: Accent
  setAccent: (a: Accent) => void
  palette: Palette
  /** Switches the background theme and applies its suggested accent. */
  setPalette: (p: Palette) => void
  depth: boolean
  setDepth: (on: boolean) => void
}>({
  theme: 'dark',
  preference: 'system',
  setPreference: () => {},
  cycleTheme: () => {},
  accent: DEFAULT_ACCENT,
  setAccent: () => {},
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
  depth: true,
  setDepth: () => {},
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

function readPalette(): Palette {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    if (isPalette(v)) return v
  } catch {}
  return DEFAULT_PALETTE
}

function readDepth(): boolean {
  try { return localStorage.getItem(DEPTH_KEY) !== 'off' } catch {}
  return true
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
  const palette = useSyncExternalStore(subscribePreference, readPalette, () => DEFAULT_PALETTE)
  const depth = useSyncExternalStore(subscribePreference, readDepth, () => true)

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

  useEffect(() => {
    // Navy is the base palette in :root, so it needs no attribute.
    const root = document.documentElement
    if (palette === DEFAULT_PALETTE) root.removeAttribute('data-palette')
    else root.setAttribute('data-palette', palette)
    // Match the mobile browser bar to the page background.
    const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim()
    if (canvas) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', canvas))
  }, [palette, theme])

  useEffect(() => {
    document.documentElement.toggleAttribute('data-flat', !depth)
  }, [depth])

  // Pointer tilt for [data-tilt] tiles: one delegated listener, rAF-throttled.
  // CSS ignores the vars when depth is off or the user prefers reduced motion.
  useEffect(() => {
    if (!depth) return
    let active: HTMLElement | null = null
    let frame = 0
    const reset = (el: HTMLElement | null) => {
      el?.style.removeProperty('--tilt-x')
      el?.style.removeProperty('--tilt-y')
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]') ?? null
      if (el !== active) { reset(active); active = el }
      if (!el) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        el.style.setProperty('--tilt-x', `${(-py * TILT_MAX_DEG * 2).toFixed(2)}deg`)
        el.style.setProperty('--tilt-y', `${(px * TILT_MAX_DEG * 2).toFixed(2)}deg`)
      })
    }
    const onLeave = () => { reset(active); active = null }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      reset(active)
      document.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [depth])

  const setDepth = useCallback((on: boolean) => {
    try { localStorage.setItem(DEPTH_KEY, on ? 'on' : 'off') } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  const setPalette = useCallback((p: Palette) => {
    const suggested = PALETTES.find(x => x.id === p)?.accent ?? DEFAULT_ACCENT
    try {
      localStorage.setItem(PALETTE_KEY, p)
      localStorage.setItem(ACCENT_KEY, suggested)
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

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
    <ThemeContext.Provider value={{ theme, preference, setPreference, cycleTheme, accent, setAccent, palette, setPalette, depth, setDepth }}>
      {children}
    </ThemeContext.Provider>
  )
}
