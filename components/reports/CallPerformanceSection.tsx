'use client'
import { useState, useEffect } from 'react'
import { Loader2, Phone, Target, Check, X, PhoneOutgoing } from 'lucide-react'

interface AgentRow {
  agent_id: string | null
  agent_name: string
  calls: number
  connected: number
  voicemail: number
  no_answer: number
  unknown: number
  interested: number
  appointments: number
  talk_sec: number
  connected_talk_sec: number
  connect_rate: number
  avg_talk_sec: number
  conversion_rate: number
}

interface NumberRow {
  from_number: string
  label: string | null
  calls: number
  connected: number
  voicemail: number
  no_answer: number
  unknown: number
  appointments: number
  talk_sec: number
  connected_talk_sec: number
  connect_rate: number
  avg_talk_sec: number
}

interface ApiResponse {
  label: string
  summary: AgentRow[]
  byNumber?: NumberRow[]
  dailyTarget: number
  days: number | null
  effectiveTarget: number | null
}

/** +19086395666 → "+1 908 639 5666". Mirrors prettyNumber in lib/voice/format. */
function prettyNumber(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164.trim())
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164
}

// M:SS (or H:MM:SS over an hour) — mirrors fmtDuration in lib/dialer-report.
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`
}

interface Props {
  /** 'Team Call Performance' for admins/managers, 'My Call Performance' for an agent. */
  title?: string
  from?: string
  to?: string
}

export function CallPerformanceSection({ title = 'Call Performance', from, to }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    fetch(`/api/reports/call-performance?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (active) { setData(d?.summary ? d : null); setLoading(false) } })
      .catch(() => { if (active) { setData(null); setLoading(false) } })
    return () => { active = false }
  }, [from, to])

  const rows = data?.summary ?? []
  const numberRows = data?.byNumber ?? []
  const target = data?.effectiveTarget ?? null

  // Totals footer.
  const totals = rows.reduce(
    (t, r) => {
      t.calls += r.calls; t.connected += r.connected; t.voicemail += r.voicemail
      t.no_answer += r.no_answer; t.unknown += r.unknown
      t.appointments += r.appointments; t.talk_sec += r.talk_sec
      t.connected_talk_sec += r.connected_talk_sec
      return t
    },
    { calls: 0, connected: 0, voicemail: 0, no_answer: 0, unknown: 0, appointments: 0, talk_sec: 0, connected_talk_sec: 0 },
  )
  const totalConnectRate = totals.calls ? Math.round((totals.connected / totals.calls) * 100) : 0
  const totalConvRate = totals.calls ? Math.round((totals.appointments / totals.calls) * 100) : 0
  const totalAvgTalk = totals.connected ? Math.round(totals.connected_talk_sec / totals.connected) : 0

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Phone size={16} className="text-orange-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
        </div>
        {target != null && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Target size={13} className="text-orange-400" aria-hidden="true" />
            <span>
              Target: <span className="text-slate-200 font-medium">{target}</span> call{target === 1 ? '' : 's'}
              {data?.days && data.days > 1 ? ` (${data.dailyTarget}/day × ${data.days})` : ''}
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-slate-500 text-sm py-8">No call data for this period</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead>
              <tr className="text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left font-medium py-2 px-2">Agent</th>
                <th className="text-right font-medium py-2 px-2">Calls</th>
                <th className="text-right font-medium py-2 px-2">Conn.</th>
                <th className="text-right font-medium py-2 px-2">Conn %</th>
                <th className="text-right font-medium py-2 px-2">VM</th>
                <th className="text-right font-medium py-2 px-2">No ans.</th>
                <th className="text-right font-medium py-2 px-2" title="Answered, but the agent skipped the wrap-up — we cannot tell whether a human was reached, so these are not counted as connected.">Unmarked</th>
                <th className="text-right font-medium py-2 px-2">Appts</th>
                <th className="text-right font-medium py-2 px-2">Conv %</th>
                <th className="text-right font-medium py-2 px-2">Avg talk</th>
                <th className="text-right font-medium py-2 px-2">Talk time</th>
                {target != null && <th className="text-right font-medium py-2 px-2">Target</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const met = target != null && r.calls >= target
                return (
                  <tr key={r.agent_id ?? r.agent_name} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(r.agent_name ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <span className="text-slate-200 truncate max-w-[160px]">{r.agent_name}</span>
                      </div>
                    </td>
                    <td className="text-right px-2 tabular-nums font-semibold text-slate-100">{r.calls}</td>
                    <td className="text-right px-2 tabular-nums text-slate-300">{r.connected}</td>
                    <td className="text-right px-2 tabular-nums text-slate-400">{r.connect_rate}%</td>
                    <td className="text-right px-2 tabular-nums text-slate-400">{r.voicemail}</td>
                    <td className="text-right px-2 tabular-nums text-slate-400">{r.no_answer}</td>
                    <td className={`text-right px-2 tabular-nums ${r.unknown > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{r.unknown}</td>
                    <td className="text-right px-2 tabular-nums text-green-400 font-medium">{r.appointments}</td>
                    <td className="text-right px-2 tabular-nums text-slate-400">{r.conversion_rate}%</td>
                    <td className="text-right px-2 tabular-nums text-slate-400">{fmtDuration(r.avg_talk_sec)}</td>
                    <td className="text-right px-2 tabular-nums text-slate-300">{fmtDuration(r.talk_sec)}</td>
                    {target != null && (
                      <td className="text-right px-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
                            met ? 'bg-green-900/30 text-green-400' : 'bg-red-900/20 text-red-400'
                          }`}
                          title={met ? `Hit target (${target})` : `${target - r.calls} below target`}
                        >
                          {met ? <Check size={12} /> : <X size={12} />}
                          {met ? 'Met' : `−${target - r.calls}`}
                        </span>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-700 font-semibold text-slate-200">
                <td className="py-2 px-2">Total</td>
                <td className="text-right px-2 tabular-nums">{totals.calls}</td>
                <td className="text-right px-2 tabular-nums">{totals.connected}</td>
                <td className="text-right px-2 tabular-nums text-slate-400">{totalConnectRate}%</td>
                <td className="text-right px-2 tabular-nums text-slate-400">{totals.voicemail}</td>
                <td className="text-right px-2 tabular-nums text-slate-400">{totals.no_answer}</td>
                <td className={`text-right px-2 tabular-nums ${totals.unknown > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{totals.unknown}</td>
                <td className="text-right px-2 tabular-nums text-green-400">{totals.appointments}</td>
                <td className="text-right px-2 tabular-nums text-slate-400">{totalConvRate}%</td>
                <td className="text-right px-2 tabular-nums text-slate-400">{fmtDuration(totalAvgTalk)}</td>
                <td className="text-right px-2 tabular-nums">{fmtDuration(totals.talk_sec)}</td>
                {target != null && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Per caller ID. Same calls, sliced by the number they went out on: a connect
          rate that collapses on one number while every agent's own figures hold steady
          is the carrier-reputation signal, not a performance one. Hidden entirely when
          no row in range recorded a from_number (true of anything before Aug 2026). */}
      {!loading && numberRows.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-2">
            <PhoneOutgoing className="h-4 w-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-slate-200">By caller ID</h3>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Which of our numbers placed the calls. A number whose connect rate drops well
            below the others is likely being labelled by carriers — rest it or take it out
            of the pool in Settings → Calls.
          </p>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[740px] border-collapse text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2 text-left font-medium">Number</th>
                  <th className="px-2 py-2 text-right font-medium">Calls</th>
                  <th className="px-2 py-2 text-right font-medium">Conn.</th>
                  <th className="px-2 py-2 text-right font-medium">Conn %</th>
                  <th className="px-2 py-2 text-right font-medium">VM</th>
                  <th className="px-2 py-2 text-right font-medium">No ans.</th>
                  <th className="px-2 py-2 text-right font-medium">Unmarked</th>
                  <th className="px-2 py-2 text-right font-medium">Appts</th>
                  <th className="px-2 py-2 text-right font-medium">Avg talk</th>
                  <th className="px-2 py-2 text-right font-medium">Talk time</th>
                </tr>
              </thead>
              <tbody>
                {numberRows.map(n => (
                  <tr key={n.from_number} className="border-t border-slate-800 hover:bg-slate-800/40">
                    <td className="px-2 py-2">
                      {n.label && <div className="truncate text-slate-200">{n.label}</div>}
                      <div className="text-xs tabular-nums text-slate-500">{prettyNumber(n.from_number)}</div>
                    </td>
                    <td className="px-2 text-right font-semibold tabular-nums text-slate-100">{n.calls}</td>
                    <td className="px-2 text-right tabular-nums text-slate-300">{n.connected}</td>
                    <td className="px-2 text-right tabular-nums text-slate-400">{n.connect_rate}%</td>
                    <td className="px-2 text-right tabular-nums text-slate-400">{n.voicemail}</td>
                    <td className="px-2 text-right tabular-nums text-slate-400">{n.no_answer}</td>
                    <td className={`px-2 text-right tabular-nums ${n.unknown > 0 ? 'text-amber-400' : 'text-slate-400'}`}>{n.unknown}</td>
                    <td className="px-2 text-right font-medium tabular-nums text-green-400">{n.appointments}</td>
                    <td className="px-2 text-right tabular-nums text-slate-400">{fmtDuration(n.avg_talk_sec)}</td>
                    <td className="px-2 text-right tabular-nums text-slate-300">{fmtDuration(n.talk_sec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
