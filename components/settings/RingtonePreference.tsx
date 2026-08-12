'use client'
import { useState, useEffect } from 'react'
import { Volume2, Info } from 'lucide-react'
import { ringMuted, setRingMuted } from '@/lib/voice/ringtone'

/**
 * Per-agent ringtone preference — the one setting on this page everybody gets.
 *
 * Stored in this browser rather than in the database, matching the Mute button on the
 * incoming-call popup: the two read and write the same value, so muting from either
 * place agrees. That does mean the choice doesn't follow an agent to another machine,
 * which the copy says outright rather than letting them discover it.
 *
 * It only has an effect while the ringtone is on org-wide, so we read that switch too
 * and say so plainly instead of offering a control that silently does nothing.
 */
export function RingtonePreference() {
  const [muted, setMuted]   = useState(false)
  const [orgOn, setOrgOn]   = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // localStorage is read in here rather than at render: this renders on the server
    // first, where there is no such thing, and a mismatch would flash the wrong state.
    const readLocal = () => {
      setMuted(ringMuted())
      setLoaded(true)
    }
    fetch('/api/settings/ringtone')
      .then(r => r.json())
      .then(d => {
        setOrgOn(!!d?.enabled)
        readLocal()
      })
      .catch(readLocal)
  }, [])

  function toggle() {
    const next = !muted
    setMuted(next)
    setRingMuted(next)
  }

  const on = loaded && orgOn && !muted

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <Volume2 className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">My Incoming Call Sound</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Whether your browser plays a ringing tone when a lead calls in. This is yours
        alone and changes nothing for anyone else. The incoming-call popup appears
        either way — muting only removes the sound. A call arriving while you&apos;re
        already on one is always silent.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={toggle}
          disabled={!loaded || !orgOn}
          role="switch"
          aria-checked={on}
          aria-label="My incoming call sound"
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-orange-500' : 'bg-white/10'}`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${on ? 'left-[26px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-sm text-slate-300">
          {!loaded ? 'Loading…' : !orgOn ? 'Silent' : muted ? 'Muted on this browser' : 'Ringing on this browser'}
        </span>
      </div>

      {loaded && !orgOn && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400 mt-3">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          The ringtone is currently switched off for everyone. Ask an admin to turn it on
          in Settings before this will do anything.
        </p>
      )}

      {loaded && orgOn && (
        <p className="text-xs text-slate-500 mt-3">
          Saved in this browser only — set it again on any other computer you sign in from.
        </p>
      )}
    </div>
  )
}
