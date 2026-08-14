'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Loader2, Download, Volume2, VolumeX, AlertCircle } from 'lucide-react'

/**
 * Inline recording player.
 *
 * Twilio recordings are auth-protected, so they stream through our
 * /api/voice/twilio/recording proxy; Bland recordings are public and play directly.
 *
 * The file is downloaded in full before playing rather than streamed into a native
 * <audio controls>. Twilio transcodes to MP3 on the fly, and what arrives has no
 * dependable length — the browser guessed a one-second duration, which left the native
 * scrub bar with nothing to seek across and no way to drag it. A Blob is a local,
 * fully-known resource, so the browser reports a real duration and seeking always
 * works. Recordings are minutes of speech-rate MP3, a few hundred KB, so the wait is
 * short and it only happens when someone actually asks to listen.
 *
 * `durationSec` is what the CRM recorded for the call: the total shown while the media
 * metadata is still unknown, and the fallback if it never becomes trustworthy.
 */
export function RecordingPlayer({
  url,
  provider,
  durationSec = null,
}: {
  url: string
  provider: string | null
  durationSec?: number | null
}) {
  const [open, setOpen] = useState(false)
  const src =
    provider === 'twilio'
      ? `/api/voice/twilio/recording?url=${encodeURIComponent(url)}`
      : url

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300"
      >
        <Play size={12} /> Recording
      </button>
    )
  }
  return <Player src={src} durationSec={durationSec} />
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function Player({ src, durationSec }: { src: string; durationSec: number | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [time, setTime] = useState(0)
  const [mediaDuration, setMediaDuration] = useState(0)
  // While the knob is held, the audio follows the pointer but timeupdate must not
  // drag the knob back to where playback happens to be.
  const [scrubbing, setScrubbing] = useState(false)

  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    ;(async () => {
      try {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`Recording unavailable (${res.status})`)
        const blob = await res.blob()
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      } catch (e: any) {
        if (alive) setError(e?.message || 'Could not load this recording.')
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  // Autoplay once the audio is in hand — the click that opened the player is the
  // gesture browsers ask for, so this is allowed.
  useEffect(() => {
    if (!blobUrl) return
    audioRef.current?.play().catch(() => {
      // Blocked (rare, restored tab) — the play button still works.
    })
  }, [blobUrl])

  // A duration of 0/Infinity means the browser hasn't worked it out; the stored call
  // length stands in so the bar is still usable.
  const duration =
    Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : (durationSec && durationSec > 0 ? durationSec : 0)
  const seekable = duration > 0

  const seek = useCallback((to: number) => {
    const a = audioRef.current
    if (!a) return
    const next = Math.min(Math.max(to, 0), duration || 0)
    a.currentTime = next
    setTime(next)
  }, [duration])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }, [])

  if (error) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-red-400">
        <AlertCircle size={13} /> {error}
      </p>
    )
  }

  const loading = !blobUrl

  return (
    <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          preload="auto"
          onLoadedMetadata={e => setMediaDuration(e.currentTarget.duration)}
          // Chrome settles on the true duration only after the whole file is parsed.
          onDurationChange={e => setMediaDuration(e.currentTarget.duration)}
          onTimeUpdate={e => { if (!scrubbing) setTime(e.currentTarget.currentTime) }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setTime(0) }}
          onError={() => setError('This recording could not be played.')}
          className="hidden"
        />
      )}

      <div className="flex items-center gap-2.5">
        <button
          onClick={toggle}
          disabled={loading}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-orange-500 text-white
                     transition-colors hover:bg-orange-400 disabled:opacity-50 disabled:cursor-wait"
        >
          {loading
            ? <Loader2 size={15} className="animate-spin" />
            : playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>

        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={time}
          disabled={loading || !seekable}
          onPointerDown={() => setScrubbing(true)}
          onPointerUp={() => setScrubbing(false)}
          onChange={e => seek(Number(e.target.value))}
          aria-label="Seek within recording"
          aria-valuetext={`${fmtTime(time)} of ${fmtTime(duration)}`}
          className="w-full h-1.5 accent-orange-500 cursor-pointer disabled:cursor-default disabled:opacity-50"
        />

        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
          {fmtTime(time)} / {fmtTime(duration)}
        </span>

        <button
          onClick={() => {
            const a = audioRef.current
            if (!a) return
            a.muted = !a.muted
            setMuted(a.muted)
          }}
          disabled={loading}
          aria-label={muted ? 'Unmute recording' : 'Mute recording'}
          className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>

        {/* Saves the copy already in the browser, so no second authenticated fetch. */}
        {blobUrl && (
          <a
            href={blobUrl}
            download="call-recording.mp3"
            aria-label="Download recording"
            title="Download recording"
            className="shrink-0 text-slate-500 hover:text-orange-400 transition-colors"
          >
            <Download size={14} />
          </a>
        )}
      </div>

      {loading && (
        <p className="mt-1.5 text-[10px] text-slate-500">Loading recording…</p>
      )}
      {!loading && !seekable && (
        <p className="mt-1.5 text-[10px] text-slate-500">
          Length unknown for this recording — playback works, seeking doesn&apos;t.
        </p>
      )}
    </div>
  )
}
