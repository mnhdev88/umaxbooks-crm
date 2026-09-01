'use client'
import { useState, useEffect } from 'react'
import { Phone, CheckCircle, AlertCircle } from 'lucide-react'

// Team-wide daily call target, editable by sales staff as well as admins
// (lib/settings-access.ts). Used by the Reports → Call Performance
// dashboard. Reads/writes app_settings.daily_call_target via /api/settings/call-target.
export function CallTargetSetting() {
  const [value, setValue]     = useState('')
  const [loaded, setLoaded]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/call-target')
      .then(r => r.json())
      .then(d => { setValue(String(d?.target ?? 50)); setLoaded(true) })
      .catch(() => { setValue('50'); setLoaded(true) })
  }, [])

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/call-target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: Number(value) }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setValue(String(data.target))
      setResult({ ok: true, msg: `Saved — target is ${data.target} calls/day.` })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  const num = Math.trunc(Number(value))
  const valid = Number.isFinite(num) && num >= 1 && num <= 1000

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Phone className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Daily Call Target</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        The per-day call goal each sales agent and manager is measured against in
        Reports → Call Performance.
      </p>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Calls per day</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={value}
            disabled={!loaded}
            onChange={e => { setValue(e.target.value); setResult(null) }}
            className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </div>
        <button
          onClick={save}
          disabled={saving || !loaded || !valid}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {result && (
          <span className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
            {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {result.msg}
          </span>
        )}
      </div>
      {!valid && loaded && (
        <p className="text-xs text-amber-400 mt-2">Enter a whole number between 1 and 1000.</p>
      )}
    </div>
  )
}
