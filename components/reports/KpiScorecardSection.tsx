'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Trophy, AlertTriangle, Plus, CheckCircle, X } from 'lucide-react'

interface Row {
  kpi_key: string
  stage: string
  label: string
  unit: 'count' | 'hours' | 'percent'
  source: 'auto' | 'manual'
  target: number
  achieved: number
  weightage: number
  outputPct: number
  weighted: number
}
interface AgentScore {
  id: string
  full_name: string
  role: string
  totalScore: number
  rows: Row[]
  hasOverrides?: boolean
  weightSum?: number
  weightOk?: boolean
}
interface Payload {
  agents: AgentScore[]
  weightSum: number
  weightOk: boolean
  days: number
}

const STAGE_ORDER = ['TOFU', 'MOFU', 'BOFU', 'Learning']
const STAGE_LABELS: Record<string, string> = {
  TOFU: 'Top of funnel', MOFU: 'Middle of funnel', BOFU: 'Bottom of funnel', Learning: 'Learning',
}

// Score → colour band. A clean grade lives in [0,100].
function band(score: number) {
  if (score >= 90) return { text: 'text-green-400', ring: 'ring-green-500/40', bar: 'bg-green-500', label: 'Excellent' }
  if (score >= 70) return { text: 'text-amber-400', ring: 'ring-amber-500/40', bar: 'bg-amber-500', label: 'On track' }
  if (score >= 50) return { text: 'text-orange-400', ring: 'ring-orange-500/40', bar: 'bg-orange-500', label: 'Needs work' }
  return { text: 'text-red-400', ring: 'ring-red-500/40', bar: 'bg-red-500', label: 'Behind' }
}

function fmt(v: number, unit: Row['unit']) {
  if (unit === 'hours') return `${v}h`
  if (unit === 'percent') return `${v}%`
  return `${v}`
}

interface Props {
  isAdmin: boolean
  currentUserId: string
  from?: string
  to?: string
}

export function KpiScorecardSection({ isAdmin, currentUserId, from, to }: Props) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const res = await fetch(`/api/reports/kpi-scorecard?${params.toString()}`)
    const json = await res.json()
    setData(json)
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-orange-400" /> KPI Scorecard
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Weighted funnel score per agent{data ? ` · targets scaled over ${data.days} day${data.days === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <button
          onClick={() => setLogOpen(v => !v)}
          className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Log proposals / training
        </button>
      </div>

      {logOpen && (
        <ManualEntryForm
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          agents={data?.agents ?? []}
          onClose={() => setLogOpen(false)}
          onSaved={() => { load() }}
        />
      )}

      {data && !data.weightOk && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Default weightages add up to {data.weightSum}% — they should total 100% for scores to be comparable. Adjust in Settings → KPI Scorecard.
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-500 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : !data?.agents?.length ? (
        <p className="text-center text-slate-500 text-sm py-8">No scorecard data for this period</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {data.agents.map((a, i) => <AgentCard key={a.id} agent={a} rank={i + 1} />)}
        </div>
      )}
    </div>
  )
}

function AgentCard({ agent, rank }: { agent: AgentScore; rank: number }) {
  const b = band(agent.totalScore)
  return (
    <div className={`bg-slate-800/60 border border-slate-700/60 rounded-xl p-4 ring-1 ${b.ring}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-mono text-slate-500 w-5 text-right shrink-0">#{rank}</span>
          <div>
            <p className="text-sm font-semibold text-white truncate">{agent.full_name}</p>
            <p className="text-xs text-slate-500 capitalize">
              {agent.role.replace('_', ' ')}
              {agent.hasOverrides && (
                <span className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400 normal-case">custom targets</span>
              )}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-2xl font-bold tabular-nums ${b.text}`}>{agent.totalScore}</p>
          <p className={`text-[10px] font-medium ${b.text}`}>{b.label}</p>
        </div>
      </div>

      {/* Score bar */}
      <div className="w-full bg-slate-700/50 rounded-full h-1.5 mb-3 overflow-hidden">
        <div className={`h-full ${b.bar} rounded-full transition-all duration-500`} style={{ width: `${Math.min(agent.totalScore, 100)}%` }} />
      </div>

      {agent.weightOk === false && (
        <p className="flex items-center gap-1.5 text-[11px] text-amber-400 mb-2">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          This member&apos;s active weightages total {agent.weightSum}% — adjust them on their team profile.
        </p>
      )}

      {/* Funnel table — same columns as the Novelio KPI scorecard spreadsheet:
          Stage · KPI · Target · Achieved · Output (%) · Weightage (%) · Weighted score */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700/60">
              <th className="text-left font-medium py-1 pr-2">KPI</th>
              <th className="text-right font-medium py-1 px-1.5">Target</th>
              <th className="text-right font-medium py-1 px-1.5">Achieved</th>
              <th className="text-right font-medium py-1 px-1.5">Output %</th>
              <th className="text-right font-medium py-1 px-1.5">Weight %</th>
              <th className="text-right font-medium py-1 pl-1.5">Score</th>
            </tr>
          </thead>
          <tbody>
            {STAGE_ORDER.filter(s => agent.rows.some(r => r.stage === s)).map(stage => (
              <StageRows key={stage} stage={stage} rows={agent.rows.filter(r => r.stage === stage)} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700/60">
              <td colSpan={5} className="text-right text-slate-400 font-medium py-1.5 pr-2">Total / final score</td>
              <td className={`text-right font-bold tabular-nums py-1.5 pl-1.5 ${b.text}`}>{agent.totalScore}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// One stage's subheader row plus its KPI rows, mirroring the spreadsheet grouping.
function StageRows({ stage, rows }: { stage: string; rows: Row[] }) {
  return (
    <>
      <tr>
        <td colSpan={6} className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold pt-2 pb-0.5">
          {stage} · {STAGE_LABELS[stage] ?? stage}
        </td>
      </tr>
      {rows.map(r => {
        const rb = band(Math.min(r.outputPct, 100))
        return (
          <tr key={r.kpi_key} className="border-t border-slate-800/60">
            <td className="text-slate-300 py-1 pr-2">{r.label}</td>
            <td className="text-slate-500 tabular-nums text-right py-1 px-1.5">{fmt(r.target, r.unit)}</td>
            <td className="text-slate-300 tabular-nums text-right py-1 px-1.5">{fmt(r.achieved, r.unit)}</td>
            <td className={`tabular-nums text-right py-1 px-1.5 font-medium ${rb.text}`}>{r.outputPct}%</td>
            <td className="text-slate-500 tabular-nums text-right py-1 px-1.5">{r.weightage}%</td>
            <td className="text-slate-300 tabular-nums text-right py-1 pl-1.5">{r.weighted}</td>
          </tr>
        )
      })}
    </>
  )
}

function ManualEntryForm({ isAdmin, currentUserId, agents, onClose, onSaved }: {
  isAdmin: boolean
  currentUserId: string
  agents: AgentScore[]
  onClose: () => void
  onSaved: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [userId, setUserId] = useState(currentUserId)
  const [kpiKey, setKpiKey] = useState('proposals_sent')
  const [date, setDate] = useState(today)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/reports/kpi-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, kpi_key: kpiKey, entry_date: date, value: Number(value) }),
    })
    const json = await res.json()
    setSaving(false)
    if (res.ok) {
      setResult({ ok: true, msg: 'Saved.' })
      setValue('')
      onSaved()
    } else {
      setResult({ ok: false, msg: json.error || 'Failed to save.' })
    }
  }

  const isPct = kpiKey === 'training_completion'
  const num = Number(value)
  const valid = value !== '' && Number.isFinite(num) && num >= 0 && (!isPct || num <= 100)

  return (
    <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-200">Log a manual KPI</p>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {isAdmin && (
          <div>
            <label className="text-[10px] text-slate-500 mb-1 block">Agent</label>
            <select value={userId} onChange={e => setUserId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500/50">
              {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              {!agents.some(a => a.id === currentUserId) && <option value={currentUserId}>Me</option>}
            </select>
          </div>
        )}
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">KPI</label>
          <select value={kpiKey} onChange={e => { setKpiKey(e.target.value); setResult(null) }}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500/50">
            <option value="proposals_sent">Proposals sent (count)</option>
            <option value="training_completion">Training completion (%)</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">Date</label>
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500/50" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">{isPct ? 'Percent' : 'Count'}</label>
          <input type="number" min={0} max={isPct ? 100 : undefined} value={value}
            onChange={e => { setValue(e.target.value); setResult(null) }}
            className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500/50" />
        </div>
        <button onClick={save} disabled={saving || !valid}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {result && (
          <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ${result.ok ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
            {result.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} {result.msg}
          </span>
        )}
      </div>
      <p className="text-[10px] text-slate-500 mt-2">
        Proposals are summed over the period; training completion uses the latest figure logged.
      </p>
    </div>
  )
}
