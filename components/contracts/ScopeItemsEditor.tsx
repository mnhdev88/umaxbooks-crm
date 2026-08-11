'use client'

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { MAX_SCOPE_ITEMS, MAX_SCOPE_ITEM_LEN } from '@/lib/contract-plan'

/**
 * Editor for the Scope of Services lines a client sees in section 4 of the
 * agreement. Shared by the admin's package defaults (Settings) and the rep's
 * Send Service Agreement modal so both behave identically; only the input
 * styling differs, since the two surfaces use different palettes.
 */
interface Props {
  items: string[]
  onChange: (items: string[]) => void
  variant?: 'settings' | 'modal'
  disabled?: boolean
}

const INPUT_CLASS = {
  settings: 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50',
  modal:    'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-orange-500 placeholder-slate-600 disabled:opacity-50',
} as const

const ICON_BTN = 'p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500 transition-colors'

export function ScopeItemsEditor({ items, onChange, variant = 'modal', disabled = false }: Props) {
  const atMax = items.length >= MAX_SCOPE_ITEMS

  function edit(i: number, value: string) {
    onChange(items.map((v, idx) => (idx === i ? value : v)))
  }

  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i))
  }

  /** Swap with the neighbour in `dir`; the arrows are disabled at the ends. */
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            value={item}
            disabled={disabled}
            maxLength={MAX_SCOPE_ITEM_LEN}
            onChange={e => edit(i, e.target.value)}
            placeholder="e.g. Website Design & Development"
            aria-label={`Scope line ${i + 1}`}
            className={INPUT_CLASS[variant]}
          />
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={disabled || i === 0}
            title="Move up"
            aria-label={`Move scope line ${i + 1} up`}
            className={ICON_BTN}
          >
            <ArrowUp size={13} />
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={disabled || i === items.length - 1}
            title="Move down"
            aria-label={`Move scope line ${i + 1} down`}
            className={ICON_BTN}
          >
            <ArrowDown size={13} />
          </button>
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={disabled}
            title="Remove"
            aria-label={`Remove scope line ${i + 1}`}
            className={`${ICON_BTN} hover:text-red-400`}
          >
            <X size={13} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        disabled={disabled || atMax}
        className="flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:text-orange-300 disabled:opacity-40 disabled:hover:text-orange-400 transition-colors"
      >
        <Plus size={13} /> Add item
      </button>
      {atMax && (
        <p className="text-[11px] text-slate-500">Maximum of {MAX_SCOPE_ITEMS} lines reached.</p>
      )}
    </div>
  )
}
