'use client'
import { useState, useEffect } from 'react'
import { Clock, CheckCircle, AlertCircle } from 'lucide-react'

// Admin control for the leads calling window (app_settings.call_window_start /
// call_window_end). Drives the Leads "Call-ready first" sort and the per-row
// call-window badge. Reads/writes via /api/settings/call-window.
export function CallWindowSetting() {
  const [start, setStart]   = useState('09:30')
  const [end, setEnd]       = useState('20:00')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/call-window')
      .then(r => r.json())
      .then(d => { setStart(d?.start ?? '09:30'); setEnd(d?.end ?? '20:00'); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/call-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, end }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setStart(data.start); setEnd(data.end)
      setResult({ ok: true, msg: `Saved — agents call ${data.start}–${data.end} local.` })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Calling Window</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Hours (in each lead&apos;s own local US time zone) an agent should be calling.
        The Leads list uses this for the &quot;Call-ready first&quot; sort and the per-row
        call-window badge. Must stay within 08:00–21:00 (US TCPA legal calling hours).
      </p>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Start</label>
          <input
            type="time" value={start} disabled={!loaded}
            onChange={e => { setStart(e.target.value); setResult(null) }}
            className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">End</label>
          <input
            type="time" value={end} disabled={!loaded}
            onChange={e => { setEnd(e.target.value); setResult(null) }}
            className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </div>
        <button
          onClick={save}
          disabled={saving || !loaded}
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
    </div>
  )
}
