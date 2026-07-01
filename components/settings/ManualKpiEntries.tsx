'use client'
import { useState, useEffect, useCallback } from 'react'
import { ClipboardList, CheckCircle, AlertCircle } from 'lucide-react'

// Admin grid to log the two manual KPIs (proposals sent, training completion) for
// every sales agent and manager on a chosen day, in one place. Prefills existing
// figures for the date and bulk-saves via /api/reports/kpi-manual.

interface Staff { id: string; full_name: string; role: string }
interface Props { staff: Staff[] }

type Field = 'proposals_sent' | 'training_completion'
const cellKey = (userId: string, kpi: Field) => `${userId}:${kpi}`

export function ManualKpiEntries({ staff }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setResult(null)
    const res = await fetch(`/api/reports/kpi-manual?date=${d}`)
    const json = await res.json().catch(() => ({}))
    const next: Record<string, string> = {}
    for (const e of json?.entries ?? []) next[cellKey(e.user_id, e.kpi_key)] = String(e.value)
    setValues(next)
    setLoading(false)
  }, [])

  useEffect(() => { load(date) }, [date, load])

  function setCell(userId: string, kpi: Field, v: string) {
    setValues(prev => ({ ...prev, [cellKey(userId, kpi)]: v }))
    setResult(null)
  }

  async function save() {
    setSaving(true)
    setResult(null)
    const entries: { user_id: string; kpi_key: Field; entry_date: string; value: number }[] = []
    for (const s of staff) {
      for (const kpi of ['proposals_sent', 'training_completion'] as Field[]) {
        const raw = values[cellKey(s.id, kpi)]
        if (raw === undefined || raw === '') continue
        const num = Number(raw)
        if (!Number.isFinite(num) || num < 0) continue
        if (kpi === 'training_completion' && num > 100) continue
        entries.push({ user_id: s.id, kpi_key: kpi, entry_date: date, value: num })
      }
    }
    if (!entries.length) {
      setSaving(false)
      setResult({ ok: false, msg: 'Nothing to save — enter at least one value.' })
      return
    }
    const res = await fetch('/api/reports/kpi-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    const json = await res.json()
    setSaving(false)
    if (res.ok) setResult({ ok: true, msg: `Saved ${json.saved} figure${json.saved === 1 ? '' : 's'} for ${date}.` })
    else setResult({ ok: false, msg: json.error || 'Failed to save.' })
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Manual KPI Entries</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Log <span className="text-slate-300">Proposals sent</span> and{' '}
        <span className="text-slate-300">Training completion</span> for each sales agent and
        manager — the two KPIs the system can&apos;t measure automatically. These feed
        Reports → KPI Scorecard. Proposals are summed over the period; training uses
        the latest figure logged.
      </p>

      <div className="flex items-end gap-3 mb-4">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Date</label>
          <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50" />
        </div>
      </div>

      {!staff.length ? (
        <p className="text-slate-500 text-sm">No sales agents or managers found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-white/10">
                  <th className="py-2 pr-3 font-medium">Agent</th>
                  <th className="py-2 px-3 font-medium">Role</th>
                  <th className="py-2 px-3 font-medium">Proposals sent</th>
                  <th className="py-2 px-3 font-medium">Training %</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => (
                  <tr key={s.id} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-slate-200">{s.full_name}</td>
                    <td className="py-2 px-3 text-slate-500 capitalize text-xs">{s.role.replace('_', ' ')}</td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} disabled={loading}
                        value={values[cellKey(s.id, 'proposals_sent')] ?? ''}
                        onChange={e => setCell(s.id, 'proposals_sent', e.target.value)}
                        className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" min={0} max={100} disabled={loading}
                        value={values[cellKey(s.id, 'training_completion')] ?? ''}
                        onChange={e => setCell(s.id, 'training_completion', e.target.value)}
                        className="w-24 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 mt-5 flex-wrap">
            <button onClick={save} disabled={saving || loading}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors">
              {saving ? 'Saving…' : 'Save all'}
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
