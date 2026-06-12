'use client'

import { useEffect, useRef, useState } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  ResponsiveContainer, Tooltip, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts'
import { useTheme } from '@/components/ThemeProvider'

// Recharts renders inline SVG, so its colors can't ride the globals.css light
// overrides — pick neutrals from the active theme instead.
function useChartTheme() {
  const { theme } = useTheme()
  return theme === 'light'
    ? { axis: '#57537a', track: '#EDE9FE', cursor: 'rgba(124,58,237,0.08)' }
    : { axis: '#94a3b8', track: '#1e293b', cursor: 'rgba(148,163,184,0.08)' }
}

export interface Slice { name: string; value: number; color: string }

/* ---------- Animated count-up number (no extra deps) ---------- */
export function CountUp({
  value, prefix = '', suffix = '', duration = 900, className = '',
}: { value: number; prefix?: string; suffix?: string; duration?: number; className?: string }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const started = useRef(false)

  useEffect(() => {
    // Animate once when scrolled into view (or immediately if already visible).
    const node = ref.current
    if (!node) return
    const run = () => {
      if (started.current) return
      started.current = true
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
        setDisplay(value * eased)
        if (t < 1) requestAnimationFrame(tick)
        else setDisplay(value)
      }
      requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && run()),
      { threshold: 0.2 },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [value, duration])

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}{Math.round(display).toLocaleString()}{suffix}
    </span>
  )
}

/* ---------- Shared dark tooltip ---------- */
function ChartTooltip({ active, payload, total }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const val = p.value as number
  const name = p.payload?.name ?? p.name
  const pct = total > 0 ? Math.round((val / total) * 100) : 0
  return (
    <div className="rounded-lg bg-[#0E0B24] border border-slate-700 px-3 py-2 shadow-xl">
      <p className="text-xs text-slate-300 font-medium capitalize">{String(name).replace(/_/g, ' ')}</p>
      <p className="text-sm text-slate-100 font-bold tabular-nums">
        {val.toLocaleString()} <span className="text-slate-500 font-normal">· {pct}%</span>
      </p>
    </div>
  )
}

/* ---------- Donut with center total + interactive legend ---------- */
export function Donut({
  data, centerLabel,
}: { data: Slice[]; centerLabel?: string }) {
  const [active, setActive] = useState<number | null>(null)
  const rows = data.filter((d) => d.value > 0)
  const total = rows.reduce((a, b) => a + b.value, 0)

  if (total === 0) return <Empty />

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows} dataKey="value" nameKey="name"
              innerRadius={56} outerRadius={80} paddingAngle={2}
              stroke="none" animationDuration={800}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {rows.map((d, i) => (
                <Cell
                  key={d.name} fill={d.color}
                  opacity={active === null || active === i ? 1 : 0.35}
                  style={{ transition: 'opacity 150ms' }}
                />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-slate-100 tabular-nums">
            <CountUp value={active !== null ? rows[active].value : total} />
          </span>
          <span className="text-[11px] text-slate-500 capitalize truncate max-w-[6rem] text-center">
            {active !== null ? rows[active].name.replace(/_/g, ' ') : (centerLabel ?? 'Total')}
          </span>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 w-full">
        {rows.map((d, i) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <li
              key={d.name}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              className="flex items-center gap-2.5 cursor-default rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-800/60"
              style={{ opacity: active === null || active === i ? 1 : 0.5 }}
            >
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: d.color }} />
              <span className="text-xs text-slate-300 capitalize flex-1 truncate">{d.name.replace(/_/g, ' ')}</span>
              <span className="text-xs font-mono text-slate-400 tabular-nums">{d.value.toLocaleString()} · {pct}%</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------- Horizontal bars ---------- */
export function HBars({ data }: { data: Slice[] }) {
  const ct = useChartTheme()
  const rows = data.filter((d) => d.value >= 0)
  const total = rows.reduce((a, b) => a + b.value, 0)
  if (total === 0) return <Empty />
  const pretty = rows.map((d) => ({ ...d, label: d.name.replace(/_/g, ' ') }))

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 42)}>
      <BarChart data={pretty} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category" dataKey="label" width={104}
          tick={{ fill: ct.axis, fontSize: 12 }} axisLine={false} tickLine={false}
          tickFormatter={(v) => String(v).replace(/\b\w/g, (c) => c.toUpperCase())}
        />
        <Tooltip cursor={{ fill: ct.cursor }} content={<ChartTooltip total={total} />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={800} barSize={18}>
          {pretty.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ---------- Radial gauge (single metric as a ring) ---------- */
export function RadialGauge({
  value, max, color, label,
}: { value: number; max: number; color: string; label: string }) {
  const ct = useChartTheme()
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const data = [{ name: label, value: pct, fill: color }]
  return (
    <div className="relative h-28 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="70%" outerRadius="100%" data={data}
          startAngle={90} endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: ct.track }} dataKey="value" cornerRadius={8} animationDuration={800} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-lg font-bold text-slate-100 tabular-nums">
          <CountUp value={value} />
        </span>
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
    </div>
  )
}

function Empty() {
  return <p className="text-sm text-slate-500 text-center py-10">No data in this range</p>
}
