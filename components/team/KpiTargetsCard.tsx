'use client'
import { useState, useEffect, useCallback } from 'react'
import { Trophy, Pencil, RotateCcw, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react'

// Per-user KPI scorecard targets on the team profile page. Shows the member's
// *effective* config (global defaults + their overrides, via
// /api/team/[agentId]/kpi-overrides) and, for admins / the agent's manager,
// lets it be edited in place. Rows left equal to the global default keep
// inheriting it; "Reset to defaults" drops every override.

interface KpiRow {
  kpi_key: string
  stage: string
  label: string
  unit: 'count' | 'hours' | 'percent'
  target_basis: 'per_day' | 'per_period'
  target: number
  weightage: number
  active: boolean
  overridden: boolean
  default_target: number
  default_weightage: number
  default_active: boolean
}

const unitSuffix = (u: KpiRow['unit']) => (u === 'hours' ? ' h' : u === 'percent' ? ' %' : '')

export function KpiTargetsCard({ agentId }: { agentId: string }) {
  const [rows, setRows] = useState<KpiRow[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/team/${agentId}/kpi-overrides`)
    if (res.ok) {
      const data = await res.json()
      setRows(data.rows ?? [])
      setCanEdit(Boolean(data.canEdit))
    }
    setLoaded(true)
  }, [agentId])

  useEffect(() => { load() }, [load])

  function patch(key: string, field: 'target' | 'weightage' | 'active', value: number | boolean) {
    setRows(rs => rs.map(r => (r.kpi_key === key ? { ...r, [field]: value } : r)))
    setResult(null)
  }

  const hasOverrides = rows.some(r => r.overridden)
  const weightSum = rows.filter(r => r.active).reduce((s, r) => s + Number(r.weightage || 0), 0)
  const weightOk = Math.round(weightSum) === 100

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch(`/api/team/${agentId}/kpi-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: rows.map(r => ({ kpi_key: r.kpi_key, target: Number(r.target), weightage: Number(r.weightage), active: r.active })),
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setRows(data.rows ?? rows)
      setEditing(false)
      setResult({ ok: true, msg: 'Saved.' })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  async function reset() {
    setSaving(true)
    setResult(null)
    const res = await fetch(`/api/team/${agentId}/kpi-overrides`, { method: 'DELETE' })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setRows(data.rows ?? rows)
      setEditing(false)
      setResult({ ok: true, msg: 'Reset to org defaults.' })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to reset.' })
    }
  }

  function cancel() {
    setEditing(false)
    setResult(null)
    load()
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Trophy size={15} className="text-orange-400" aria-hidden="true" /> KPI Targets
          {loaded && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${hasOverrides ? 'bg-orange-900/30 text-orange-400' : 'bg-slate-800 text-slate-400'}`}>
              {hasOverrides ? 'Custom' : 'Org defaults'}
            </span>
          )}
        </h3>
        {canEdit && !editing && loaded && (
          <button
            onClick={() => { setEditing(true); setResult(null) }}
            className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors"
          >
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Targets and weightages behind this member&apos;s Reports → KPI Scorecard grade.
        KPIs left at the org default keep following Settings → KPI Scorecard.
      </p>

      {!loaded ? (
        <div className="flex items-center justify-center py-8 text-slate-500 gap-2 text-sm">
          <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…
        </div>
      ) : !rows.length ? (
        <p className="text-sm text-slate-500 text-center py-6">No KPI config found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
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
                  <tr key={r.kpi_key} className={`border-b border-slate-800/60 ${!editing && !r.active ? 'opacity-50' : ''}`}>
                    <td className="py-2 pr-3 text-slate-200">
                      {r.label}
                      {r.overridden && !editing && (
                        <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-900/30 text-orange-400 align-middle">custom</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-400">{r.stage}</td>
                    <td className="py-2 px-3">
                      {editing ? (
                        <input type="number" min={0} value={String(r.target)}
                          onChange={e => patch(r.kpi_key, 'target', Number(e.target.value))}
                          className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 text-sm focus:outline-none focus:border-orange-500/50" />
                      ) : (
                        <span className="text-slate-200 tabular-nums">{r.target}</span>
                      )}
                      <span className="text-slate-500">{unitSuffix(r.unit)}</span>
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-xs">{r.target_basis === 'per_day' ? 'per day' : 'per period'}</td>
                    <td className="py-2 px-3">
                      {editing ? (
                        <input type="number" min={0} max={100} value={String(r.weightage)}
                          onChange={e => patch(r.kpi_key, 'weightage', Number(e.target.value))}
                          className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100 text-sm focus:outline-none focus:border-orange-500/50" />
                      ) : (
                        <span className="text-slate-200 tabular-nums">{r.weightage}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <input type="checkbox" checked={r.active} disabled={!editing}
                        onChange={e => patch(r.kpi_key, 'active', e.target.checked)}
                        className="accent-orange-500 w-4 h-4 disabled:opacity-60" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 mt-4 flex-wrap">
            {(editing || !weightOk) && (
              <span className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${weightOk ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-amber-400 bg-amber-400/10 border-amber-400/20'}`}>
                Active weightage total: {Math.round(weightSum * 10) / 10}%{weightOk ? ' ✓' : ' (should be 100%)'}
              </span>
            )}
            {editing && (
              <>
                <button onClick={save} disabled={saving}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancel} disabled={saving}
                  className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors">
                  <X size={12} aria-hidden="true" /> Cancel
                </button>
                {hasOverrides && (
                  <button onClick={reset} disabled={saving}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 px-2 py-1.5 transition-colors">
                    <RotateCcw size={12} aria-hidden="true" /> Reset to org defaults
                  </button>
                )}
              </>
            )}
            {result && (
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ${result.ok ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                {result.ok ? <CheckCircle size={13} aria-hidden="true" /> : <AlertCircle size={13} aria-hidden="true" />} {result.msg}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
