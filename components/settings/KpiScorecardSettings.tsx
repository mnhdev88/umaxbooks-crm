'use client'
import { useState, useEffect } from 'react'
import { Trophy, CheckCircle, AlertCircle } from 'lucide-react'

// Admin editor for the weighted KPI scorecard: per-KPI Target + Weightage, and
// whether the KPI is active. Reads/writes kpi_scorecard_config via
// /api/settings/kpi-scorecard. Weightages of active rows should total 100%.

interface ConfigRow {
  kpi_key: string
  stage: string
  label: string
  unit: 'count' | 'hours' | 'percent'
  target: number | string
  target_basis: 'per_day' | 'per_period'
  weightage: number | string
  active: boolean
}

export function KpiScorecardSettings() {
  const [rows, setRows] = useState<ConfigRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/kpi-scorecard')
      .then(r => r.json())
      .then(d => { setRows(d?.config ?? []); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  function patch(key: string, field: 'target' | 'weightage' | 'active', value: number | boolean) {
    setRows(rs => rs.map(r => r.kpi_key === key ? { ...r, [field]: value } : r))
    setResult(null)
  }

  const weightSum = rows.filter(r => r.active).reduce((s, r) => s + Number(r.weightage || 0), 0)
  const weightOk = Math.round(weightSum) === 100

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/kpi-scorecard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rows.map(r => ({ kpi_key: r.kpi_key, target: Number(r.target), weightage: Number(r.weightage), active: r.active })) }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setRows(data.config ?? rows)
      setResult({ ok: true, msg: 'Saved.' })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">KPI Scorecard</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Targets and weightages behind Reports → KPI Scorecard. Per-day targets are
        scaled by the number of days in the selected range. Active weightages should
        total 100%.
      </p>

      {!loaded ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">KPI</th>
                  <th className="py-2 px-3 font-medium">Stage</th>
                  <th className="py-2 px-3 font-medium">Target</th>
                  <th className="py-2 px-3 font-medium">Basis</th>
                  <th className="py-2 px-3 font-medium">Weight %</th>
                  <th className="py-2 px-3 font-medium text-center">Active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.kpi_key} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-slate-200">{r.label}</td>
                    <td className="py-2 px-3 text-slate-400">{r.stage}</td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} value={String(r.target)}
                        onChange={e => patch(r.kpi_key, 'target', Number(e.target.value))}
                        className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      {r.unit === 'hours' ? ' h' : r.unit === 'percent' ? ' %' : ''}
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-xs">{r.target_basis === 'per_day' ? 'per day' : 'per period'}</td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} max={100} value={String(r.weightage)}
                        onChange={e => patch(r.kpi_key, 'weightage', Number(e.target.value))}
                        className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input type="checkbox" checked={r.active}
                        onChange={e => patch(r.kpi_key, 'active', e.target.checked)}
                        className="accent-orange-500 w-4 h-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <span className={`text-sm font-medium px-3 py-1.5 rounded-lg border ${weightOk ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-amber-400 bg-amber-400/10 border-amber-400/20'}`}>
              Active weightage total: {Math.round(weightSum * 10) / 10}%{weightOk ? ' ✓' : ' (should be 100%)'}
            </span>
            <button onClick={save} disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {result && (
              <span className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
                {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                {result.msg}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
