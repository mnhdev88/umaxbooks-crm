'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Calendar, X } from 'lucide-react'

// Format a Date as YYYY-MM-DD in LOCAL time (not UTC — toISOString would shift).
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type Preset = { key: string; label: string; range: () => { from: string; to: string } }

const PRESETS: Preset[] = [
  {
    key: 'today',
    label: 'Today',
    range: () => { const t = ymd(new Date()); return { from: t, to: t } },
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    range: () => { const d = new Date(); d.setDate(d.getDate() - 1); const t = ymd(d); return { from: t, to: t } },
  },
  {
    key: 'week',
    label: 'This Week',
    range: () => {
      const now = new Date()
      const start = new Date(now)
      const dow = (now.getDay() + 6) % 7 // days since Monday (Mon=0 … Sun=6)
      start.setDate(now.getDate() - dow)
      return { from: ymd(start), to: ymd(now) }
    },
  },
  {
    key: 'month',
    label: 'This Month',
    range: () => {
      const now = new Date()
      return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) }
    },
  },
]

interface Props {
  from?: string
  to?: string
  label: string
}

export function ReportsDateFilter({ from, to, label }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const apply = useCallback((next: { from?: string; to?: string }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next.from) params.set('from', next.from); else params.delete('from')
    if (next.to) params.set('to', next.to); else params.delete('to')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Which preset (if any) matches the current from/to.
  const activePreset = PRESETS.find(p => {
    const r = p.range()
    return r.from === from && r.to === to
  })?.key
  const isAllTime = !from && !to

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-slate-300">
          <Calendar size={16} className="text-orange-400" aria-hidden="true" />
          <span className="text-sm font-semibold">Date range</span>
        </div>

        {/* Quick presets */}
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => apply(p.range())}
              aria-pressed={activePreset === p.key}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                activePreset === p.key
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => apply({})}
            aria-pressed={isAllTime}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              isAllTime ? 'bg-orange-500 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Time
          </button>
        </div>

        {/* Custom calendar range */}
        <div className="flex items-center gap-2 ml-auto">
          <input
            type="date"
            aria-label="From date"
            value={from ?? ''}
            max={to || undefined}
            onChange={(e) => apply({ from: e.target.value || undefined, to })}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 [color-scheme:dark]"
          />
          <span className="text-slate-500 text-xs">to</span>
          <input
            type="date"
            aria-label="To date"
            value={to ?? ''}
            min={from || undefined}
            onChange={(e) => apply({ from, to: e.target.value || undefined })}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 [color-scheme:dark]"
          />
          {!isAllTime && (
            <button
              type="button"
              onClick={() => apply({})}
              aria-label="Clear date range"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500 mt-2.5">
        Showing: <span className="text-slate-300 font-medium">{label}</span>
      </p>
    </div>
  )
}
