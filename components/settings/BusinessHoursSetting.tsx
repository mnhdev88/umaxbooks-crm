'use client'
import { useState, useEffect } from 'react'
import { PhoneIncoming, CheckCircle, AlertCircle } from 'lucide-react'

// Admin control for the office's working hours. A caller reaching one of our inbound
// lines inside these hours rings the team; outside them they go straight to the
// after-hours voicemail greeting instead of listening to 35 seconds of dead ringing.
// Reads/writes /api/settings/business-hours.
//
// The timezone is editable here as of 099. It used to be borrowed from the Reporting
// Day card, until the two had to diverge — reporting stays on IST so a shift crossing
// IST midnight lands in one day, while the phones run on US Eastern hours. Saving here
// touches business_timezone only; the reporting boundary is not affected.

const DAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
]

// Mirrors the Reporting Day card's list; any IANA name is accepted via "Other…".
const COMMON_ZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Europe/London', 'UTC',
]

// What "09:30 in New York" reads as on the team's own clock, right now. The team is in
// India and the hours are stored in Eastern, so this is the number they actually plan
// their day around — and because Eastern observes DST and IST doesn't, it legitimately
// moves twice a year. Showing it live beats documenting it and hoping someone reads it.
function inViewerZone(hhmm: string, tz: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  try {
    // Resolve the wall time in `tz` on today's date, then re-render that instant
    // locally. Two passes: guess UTC, measure the zone's offset, correct.
    const now = new Date()
    const guess = Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
      Number(m[1]), Number(m[2])
    )
    const seen = new Date(new Date(guess).toLocaleString('en-US', { timeZone: tz }))
    const offset = seen.getTime() - new Date(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    const instant = new Date(guess - offset)
    return instant.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return null
  }
}

export function BusinessHoursSetting() {
  const [open, setOpen] = useState('09:30')
  const [close, setClose] = useState('18:30')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [tz, setTz] = useState('America/New_York')
  const [customTz, setCustomTz] = useState('')
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
        if (d?.timezone) {
          if (COMMON_ZONES.includes(d.timezone)) setTz(d.timezone)
          else { setTz('__other'); setCustomTz(d.timezone) }
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const effectiveTz = tz === '__other' ? customTz.trim() : tz
  const localOpen = inViewerZone(open, effectiveTz)
  const localClose = inViewerZone(close, effectiveTz)

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
      body: JSON.stringify({ open, close, days, timezone: effectiveTz }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      const names = DAYS.filter((d) => data.days.includes(d.iso)).map((d) => d.label).join(', ')
      setResult({ ok: true, msg: `Saved — ${data.open}–${data.close} ${data.timezone}, ${names}.` })
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
        through 35 seconds of ringing. Working days are read in this same timezone.
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
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Timezone</label>
          <select
            value={tz}
            disabled={!loaded}
            onChange={(e) => { setTz(e.target.value); setResult(null) }}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
          >
            {COMMON_ZONES.map((z) => (
              <option key={z} value={z} className="bg-[#160E32]">{z}</option>
            ))}
            <option value="__other" className="bg-[#160E32]">Other…</option>
          </select>
        </div>
        {tz === '__other' && (
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">IANA timezone</label>
            <input
              type="text"
              placeholder="e.g. America/New_York"
              value={customTz}
              disabled={!loaded}
              onChange={(e) => { setCustomTz(e.target.value); setResult(null) }}
              className="w-48 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
            />
          </div>
        )}
        <button
          onClick={save}
          disabled={saving || !loaded || !days.length || !effectiveTz}
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

      {/* The team sits in a different zone from the one the hours are stored in, so
          spell out what the shift is on their clock. This shifts by an hour when the
          business timezone enters or leaves DST — that's real, and better seen here
          than discovered by a caller reaching voicemail at what they think is 9am. */}
      {loaded && localOpen && localClose && (
        <p className="text-xs text-slate-500 mt-4">
          Right now that is{' '}
          <span className="text-slate-300">{localOpen} – {localClose}</span> in your
          local time. If the business timezone observes daylight saving and yours does
          not, this shifts by an hour twice a year.
        </p>
      )}
    </div>
  )
}
