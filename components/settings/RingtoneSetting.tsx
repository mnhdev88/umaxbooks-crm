'use client'
import { useState, useEffect } from 'react'
import { Bell, CheckCircle, AlertCircle } from 'lucide-react'

// Org-wide switch for the sound the dialer makes when a call comes in. Off means the
// incoming-call popup still appears for every agent — it just arrives silently.
// Reads/writes app_settings.dialer_ringtone_enabled via /api/settings/ringtone.
export function RingtoneSetting() {
  const [enabled, setEnabled] = useState(false)
  const [loaded, setLoaded]   = useState(false)
  const [saving, setSaving]   = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/ringtone')
      .then(r => r.json())
      .then(d => {
        setEnabled(!!d?.enabled)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function toggle() {
    const next = !enabled
    setSaving(true)
    setResult(null)
    const res  = await fetch('/api/settings/ringtone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok) {
      setEnabled(!!data.enabled)
      setResult({
        ok: true,
        msg: data.enabled
          ? 'Incoming calls will ring out loud.'
          : 'Incoming calls are silent — the popup still appears.',
      })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Incoming Call Ringtone</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Whether the dialer plays a ringing tone when a lead calls back. This applies to
        everyone. Turning it off changes nothing about routing or visibility — the
        incoming-call popup still appears for every agent, it just arrives without sound.
        A call that lands while an agent is already on one is always silent, whatever
        this is set to.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={toggle}
          disabled={saving || !loaded}
          role="switch"
          aria-checked={enabled}
          aria-label="Incoming call ringtone"
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${enabled ? 'bg-orange-500' : 'bg-white/10'}`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${enabled ? 'left-[26px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-sm text-slate-300">
          {!loaded ? 'Loading…' : enabled ? 'Ringing out loud' : 'Silent — popup only'}
        </span>
        {result && (
          <span className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
            {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {result.msg}
          </span>
        )}
      </div>

      {loaded && enabled && (
        <p className="text-xs text-slate-500 mt-3">
          Individual agents can still silence their own browser from the Mute ringtone
          button on the incoming-call popup. Agents pick this up on their next page load.
        </p>
      )}
    </div>
  )
}
