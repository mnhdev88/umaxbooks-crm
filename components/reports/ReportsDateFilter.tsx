'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { Calendar, X } from 'lucide-react'
import { reportingDate, DEFAULT_REPORT_TZ, DEFAULT_DAY_START_HOUR, type ReportDayConfig } from '@/lib/reporting-day'

// Shift a 'YYYY-MM-DD' wall date by whole days (pure calendar arithmetic).
function shift(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

type Preset = { key: string; label: string; range: () => { from: string; to: string } }

// Presets are anchored to the business reporting date (timezone + day-start hour),
// so "Today" tracks the current shift's day rather than the browser's calendar day.
function buildPresets(cfg: ReportDayConfig): Preset[] {
  const today = reportingDate(new Date(), cfg)   // 'YYYY-MM-DD' in the business tz
  const [ty, tm] = today.split('-').map(Number)
  const dow = (new Date(Date.UTC(ty, tm - 1, Number(today.slice(8)))).getUTCDay() + 6) % 7 // days since Monday
  return [
    { key: 'today',     label: 'Today',      range: () => ({ from: today, to: today }) },
    { key: 'yesterday', label: 'Yesterday',  range: () => { const y = shift(today, -1); return { from: y, to: y } } },
    { key: 'week',      label: 'This Week',  range: () => ({ from: shift(today, -dow), to: today }) },
    { key: 'month',     label: 'This Month', range: () => ({ from: `${today.slice(0, 8)}01`, to: today }) },
  ]
}

interface Props {
  from?: string
  to?: string
  label: string
  tz?: string
  startHour?: number
}

export function ReportsDateFilter({ from, to, label, tz, startHour }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const PRESETS = useMemo(
    () => buildPresets({ tz: tz || DEFAULT_REPORT_TZ, startHour: startHour ?? DEFAULT_DAY_START_HOUR }),
    [tz, startHour],
  )

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
