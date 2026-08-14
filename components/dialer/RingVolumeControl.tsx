'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import {
  ringVolume, setRingVolume, onRingVolumeChange, playRingPreview,
} from '@/lib/voice/ringtone'

/**
 * Ring volume for inbound calls, sitting in the sidebar user chip.
 *
 * The incoming-call popup only exists for the ~15 seconds a call is ringing, which is
 * the worst possible moment to discover the tone is too loud and go hunting for a
 * setting. So the control lives where the agent already is, next to their own name,
 * and is reachable at any time.
 *
 * Zero is the mute — the same stored number backs this slider, the popup's toggle and
 * Settings → My Incoming Call Sound, and a change in any of them moves the others.
 * Hidden entirely when an admin has the ringtone switched off org-wide: there'd be no
 * sound to set a level for, and a dead control reads as a broken one.
 */
export function RingVolumeControl() {
  const [orgOn, setOrgOn] = useState(false)
  const [volume, setVolume] = useState(0)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/settings/ringtone')
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        setOrgOn(!!d?.enabled)
        // localStorage is read here rather than at render — the server pass has no
        // such thing, and a mismatch would flash the wrong icon.
        setVolume(ringVolume())
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Follows the Settings toggle and the popup, both of which write the same value.
  useEffect(() => onRingVolumeChange(setVolume), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => { if (previewRef.current) clearTimeout(previewRef.current) }, [])

  // Setting a volume you can't hear is guesswork, so dragging plays the ring back.
  // Debounced: the input fires on every pixel of the drag, the ear needs one burst.
  const change = useCallback((next: number) => {
    setVolume(next)
    setRingVolume(next)
    if (previewRef.current) clearTimeout(previewRef.current)
    previewRef.current = setTimeout(() => playRingPreview(next), 220)
  }, [])

  const toggleMute = useCallback(() => {
    change(volume === 0 ? 0.4 : 0)
  }, [volume, change])

  if (!orgOn) return null

  const muted = volume === 0
  const pct = Math.round(volume * 100)

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={muted ? 'Ringtone muted — set volume' : `Ringtone volume ${pct}%`}
        aria-expanded={open}
        title={muted ? 'Ringtone muted' : `Ringtone volume ${pct}%`}
        className={`p-1.5 rounded-lg transition-colors hover:bg-slate-800 ${
          muted ? 'text-slate-500 hover:text-slate-300' : 'text-orange-400 hover:text-orange-300'
        }`}
      >
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>

      {open && (
        <div
          role="group"
          aria-label="Incoming call ringtone volume"
          className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-xl border border-slate-800 bg-slate-900 p-3 shadow-xl shadow-black/40"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-slate-300">Ringtone volume</p>
            <span className="text-[11px] tabular-nums text-slate-500">
              {muted ? 'Muted' : `${pct}%`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              aria-label={muted ? 'Unmute ringtone' : 'Mute ringtone'}
              className="text-slate-500 hover:text-orange-400 transition-colors shrink-0"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={e => change(Number(e.target.value) / 100)}
              aria-label="Ringtone volume"
              className="w-full accent-orange-500 cursor-pointer"
            />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-slate-500">
            Saved in this browser. Zero mutes the ring — the incoming-call popup still appears.
          </p>
        </div>
      )}
    </div>
  )
}
