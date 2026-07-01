'use client'
import { useState, useEffect } from 'react'
import { Clock, CheckCircle, AlertCircle } from 'lucide-react'

// Admin control for the business "reporting day": the timezone and the hour each
// day starts. Fixes daily performance resetting at server midnight mid-shift —
// e.g. India (Asia/Kolkata) starting at 06:00 keeps a late US-calling shift that
// crosses midnight in a single day. Reads/writes /api/settings/reporting-day.

// A compact list of common zones; admins can type any IANA name via "Other…".
const COMMON_ZONES = [
  'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Europe/London',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC',
]

function label(h: number) {
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h).padStart(2, '0')}:00 (${h12} ${period})`
}

export function ReportingDaySetting() {
  const [tz, setTz] = useState('Asia/Kolkata')
  const [customTz, setCustomTz] = useState('')
  const [hour, setHour] = useState(6)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/reporting-day')
      .then(r => r.json())
      .then(d => {
        const z = d?.timezone || 'Asia/Kolkata'
        if (COMMON_ZONES.includes(z)) setTz(z)
        else { setTz('__other'); setCustomTz(z) }
        setHour(Number(d?.dayStartHour ?? 6))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const effectiveTz = tz === '__other' ? customTz.trim() : tz

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/reporting-day', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: effectiveTz, dayStartHour: hour }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) setResult({ ok: true, msg: `Saved — day runs ${label(data.dayStartHour)} in ${data.timezone}.` })
    else setResult({ ok: false, msg: data.error || 'Failed to save.' })
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Clock className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Reporting Day</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        When each day&apos;s performance rolls over in Reports. The day starts at this
        hour in the chosen timezone and runs 24 hours, so a late shift that crosses
        midnight stays in one day — daily numbers won&apos;t reset mid-shift.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Timezone</label>
          <select
            value={tz}
            disabled={!loaded}
            onChange={e => { setTz(e.target.value); setResult(null) }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          >
            {COMMON_ZONES.map(z => <option key={z} value={z}>{z}</option>)}
            <option value="__other">Other…</option>
          </select>
        </div>
        {tz === '__other' && (
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">IANA timezone</label>
            <input
              type="text"
              placeholder="e.g. Asia/Kolkata"
              value={customTz}
              onChange={e => { setCustomTz(e.target.value); setResult(null) }}
              className="w-48 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
            />
          </div>
        )}
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Day starts at</label>
          <select
            value={hour}
            disabled={!loaded}
            onChange={e => { setHour(Number(e.target.value)); setResult(null) }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          >
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{label(h)}</option>)}
          </select>
        </div>
        <button
          onClick={save}
          disabled={saving || !loaded || !effectiveTz}
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
