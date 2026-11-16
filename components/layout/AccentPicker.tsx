'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { ACCENTS, useTheme } from '@/components/ThemeProvider'

/** Row of accent swatches. Used in the sidebar popover and on My Profile. */
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
            className={`${dim} rounded-full flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${
              active ? 'ring-2 ring-offset-2 ring-offset-surface ring-foreground' : ''
            }`}
          >
            {active && <Check size={size === 'md' ? 15 : 12} className="text-white" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

/** Sidebar user-chip button that opens the accent swatches. */
export function AccentPicker() {
  const { accent } = useTheme()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const label = ACCENTS.find(a => a.id === accent)?.label ?? 'Violet'

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
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Accent colour: ${label}. Change`}
        aria-expanded={open}
        title={`Accent colour: ${label}`}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
      >
        <Palette size={15} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-xl shadow-black/40">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-[11px] font-semibold text-slate-300">Accent colour</p>
            <span className="text-[11px] text-slate-500">{label}</span>
          </div>
          <AccentSwatches />
        </div>
      )}
    </div>
  )
}
