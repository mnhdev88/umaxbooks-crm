'use client'
import { useState, useEffect } from 'react'
import { PhoneIncoming, CheckCircle, AlertCircle } from 'lucide-react'

// Admin control for the office's working hours. A caller reaching one of our inbound
// lines inside these hours rings the team; outside them they go straight to the
// after-hours voicemail greeting instead of listening to 35 seconds of dead ringing.
// Reads/writes /api/settings/business-hours.
//
// The timezone is shown but not editable here — it's the Reporting Day setting's
// timezone, reused so the two can't drift apart.

const DAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
]

export function BusinessHoursSetting() {
  const [open, setOpen] = useState('09:30')
  const [close, setClose] = useState('18:00')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [tz, setTz] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/business-hours')
      .then((r) => r.json())
      .then((d) => {
        if (d?.open) setOpen(d.open)
        if (d?.close) setClose(d.close)
        if (Array.isArray(d?.days) && d.days.length) setDays(d.days)
        if (d?.timezone) setTz(d.timezone)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  function toggleDay(iso: number) {
    setDays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()))
    setResult(null)
  }

  async function save() {
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/business-hours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open, close, days }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      const names = DAYS.filter((d) => data.days.includes(d.iso)).map((d) => d.label).join(', ')
      setResult({ ok: true, msg: `Saved — ${data.open}–${data.close}, ${names}.` })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <PhoneIncoming className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Working Hours (Inbound Calls)</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        When the team is available to take calls. Inside these hours an incoming call
        rings the owning agent and then the rest of the team. Outside them the caller
        goes straight to voicemail with an after-hours greeting, instead of waiting
        through 35 seconds of ringing.
        {tz ? (
          <>
            {' '}Times are in <span className="text-slate-300">{tz}</span>, the timezone
            from Reporting Day.
          </>
        ) : null}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Opens</label>
          <input
            type="time"
            value={open}
            disabled={!loaded}
            onChange={(e) => { setOpen(e.target.value); setResult(null) }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Closes</label>
          <input
            type="time"
            value={close}
            disabled={!loaded}
            onChange={(e) => { setClose(e.target.value); setResult(null) }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Working days</label>
          <div className="flex gap-1.5">
            {DAYS.map((d) => {
              const on = days.includes(d.iso)
              return (
                <button
                  key={d.iso}
                  type="button"
                  disabled={!loaded}
                  onClick={() => toggleDay(d.iso)}
                  aria-pressed={on}
                  className={`w-11 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                    on
                      ? 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>
        <button
          onClick={save}
          disabled={saving || !loaded || !days.length}
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
