'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, Moon, Palette as PaletteIcon, Sun } from 'lucide-react'
import { ACCENTS, PALETTES, ThemePreference, useTheme } from '@/components/ThemeProvider'

const ring = 'ring-2 ring-offset-2 ring-offset-surface ring-foreground'

/** Row of accent swatches. Used in the header Appearance menu and on My Profile. */
export function AccentSwatches({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { accent, setAccent } = useTheme()
  const dim = size === 'md' ? 'w-8 h-8' : 'w-6 h-6'
  return (
    <div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2">
      {ACCENTS.map(a => {
        const active = a.id === accent
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={a.label}
            title={a.label}
            onClick={() => setAccent(a.id)}
            style={{ backgroundColor: a.swatch }}
            className={`${dim} rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${active ? ring : ''}`}
          >
            {active && <Check size={size === 'md' ? 15 : 12} className="text-white" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

/** Background theme swatches: each circle is half its dark, half its light colour. */
export function PaletteSwatches({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { palette, setPalette } = useTheme()
  const dim = size === 'md' ? 'w-8 h-8' : 'w-6 h-6'
  return (
    <div role="radiogroup" aria-label="Background theme" className="flex flex-wrap gap-2">
      {PALETTES.map(p => {
        const active = p.id === palette
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={p.label}
            title={p.label}
            onClick={() => setPalette(p.id)}
            style={{ background: `linear-gradient(135deg, ${p.dark} 0 50%, ${p.light} 50% 100%)` }}
            className={`${dim} rounded-full border border-slate-600 cursor-pointer transition-transform hover:scale-110 ${active ? ring : ''}`}
          />
        )
      })}
    </div>
  )
}

const MODES: { id: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light',  label: 'Light',  Icon: Sun },
  { id: 'dark',   label: 'Dark',   Icon: Moon },
]

/** System / Light / Dark segmented switch. */
export function ModeSwitch() {
  const { preference, setPreference } = useTheme()
  return (
    <div role="radiogroup" aria-label="Mode" className="grid grid-cols-3 rounded-lg border border-slate-800 p-0.5">
      {MODES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={preference === id}
          onClick={() => setPreference(id)}
          className={`flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md cursor-pointer transition-colors ${
            preference === id ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          <Icon size={13} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** On/off switch for the 3D depth effects (shadows, bevels, hover lift, tilt). */
export function DepthSwitch() {
  const { depth, setDepth } = useTheme()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={depth}
      onClick={() => setDepth(!depth)}
      className="w-full flex items-center justify-between gap-3 cursor-pointer group"
    >
      <span className="text-left">
        <span className="block text-[11px] font-semibold text-slate-300">3D depth</span>
        <span className="block text-[11px] text-slate-500">Shadows, raised buttons, hover lift</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${depth ? 'bg-orange-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${depth ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

/** Header button next to the notification bell: mode, background theme and accent. */
export function AppearanceMenu() {
  const { palette, accent } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const paletteLabel = PALETTES.find(p => p.id === palette)?.label ?? 'Navy'
  const accentLabel = ACCENTS.find(a => a.id === accent)?.label ?? 'Violet'

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Appearance"
        aria-expanded={open}
        title="Appearance"
        className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <PaletteIcon size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-800 bg-slate-900 p-3.5 shadow-xl shadow-black/40 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-slate-300 mb-2">Mode</p>
            <ModeSwitch />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-slate-300">Theme</p>
              <span className="text-[11px] text-slate-500">{paletteLabel}</span>
            </div>
            <PaletteSwatches />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-slate-300">Accent</p>
              <span className="text-[11px] text-slate-500">{accentLabel}</span>
            </div>
            <AccentSwatches />
          </div>
          <div className="pt-3 border-t border-slate-800">
            <DepthSwitch />
          </div>
        </div>
      )}
    </div>
  )
}
