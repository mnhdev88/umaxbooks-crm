'use client'

/**
 * Ringtone for inbound calls, synthesised with WebAudio.
 *
 * Deliberately not an <audio> element pointing at an mp3: no asset to ship or cache-bust,
 * and a generated tone can't half-play a partially buffered file on a slow connection.
 *
 * Autoplay policy: browsers suspend a fresh AudioContext until the page has seen a user
 * gesture. In practice an agent has clicked something long before a call arrives, but a
 * freshly restored tab may not have — so we create the context once, then try to resume()
 * on each ring and also on the first gesture after that. A silent ring is acceptable
 * degradation; the modal still appears.
 */

/** Pre-slider mute flag. Still read once, to carry old choices over. */
const LEGACY_MUTE_KEY = 'dialer_ring_muted'
const VOL_KEY = 'dialer_ring_volume'
/** Where the level came back to when un-muting, so a mute doesn't lose it. */
const PREV_VOL_KEY = 'dialer_ring_volume_prev'
const VOLUME_CHANGED = 'dialer-ring-volume'

/** UK-style double-ring: two 0.4s bursts, then a 2s gap. */
const RING_ON = 0.4
const RING_GAP = 0.2
const RING_CYCLE = 3.0
/** Two tones an octave-ish apart read as a "phone" rather than a test beep. */
const TONE_HZ = [440, 480]
/** Gain at slider 100%. Above this the sines start to sound harsh, not louder. */
const MAX_GAIN = 0.3
const DEFAULT_VOLUME = 0.4

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_VOLUME)

/**
 * Per-browser ring volume, 0–1. Whether the ringtone exists at all is an org-wide
 * decision (app_settings.dialer_ringtone_enabled, admin-controlled in Settings) —
 * this is the individual level on top of it, for the one agent in a quiet room.
 *
 * Zero is the mute: there is one number behind the sidebar slider, the popup and the
 * Settings toggle, so they can never disagree about whether the phone rings.
 */
export function ringVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_VOLUME
  try {
    const raw = window.localStorage.getItem(VOL_KEY)
    if (raw !== null) return clamp01(parseFloat(raw))
    // First run since the slider existed: an agent who had muted stays muted.
    return window.localStorage.getItem(LEGACY_MUTE_KEY) === 'on' ? 0 : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function setRingVolume(volume: number): void {
  const v = clamp01(volume)
  try {
    const prev = ringVolume()
    if (v === 0 && prev > 0) window.localStorage.setItem(PREV_VOL_KEY, String(prev))
    window.localStorage.setItem(VOL_KEY, String(v))
    // Kept in step so anything still reading the old flag sees the same answer.
    window.localStorage.setItem(LEGACY_MUTE_KEY, v === 0 ? 'on' : 'off')
  } catch {
    // Private mode / storage disabled — the setting just won't persist.
  }
  // Every mounted control and any ringing tone follows, so the sidebar slider, the
  // popup and the Settings toggle move together.
  try {
    window.dispatchEvent(new CustomEvent<number>(VOLUME_CHANGED, { detail: v }))
  } catch {
    // Ancient browser without CustomEvent — the value is still saved.
  }
}

export function ringMuted(): boolean {
  return ringVolume() === 0
}

/** Muting parks the level at 0; unmuting returns to whatever it was before. */
export function setRingMuted(muted: boolean): void {
  if (!muted) {
    let prev = DEFAULT_VOLUME
    try {
      const raw = window.localStorage.getItem(PREV_VOL_KEY)
      if (raw !== null) prev = clamp01(parseFloat(raw))
    } catch { /* fall back to the default */ }
    setRingVolume(prev > 0 ? prev : DEFAULT_VOLUME)
    return
  }
  setRingVolume(0)
}

/** Subscribe to volume changes made anywhere in the app. Returns an unsubscribe. */
export function onRingVolumeChange(fn: (volume: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => fn(clamp01((e as CustomEvent<number>).detail))
  window.addEventListener(VOLUME_CHANGED, handler)
  return () => window.removeEventListener(VOLUME_CHANGED, handler)
}

type Ctor = typeof AudioContext
function audioCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext || (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext || null
}

/**
 * A single looping ringtone. start() is idempotent, stop() always leaves the context
 * alive (contexts are a limited resource — we reuse one for the life of the page).
 */
export function createRingtone() {
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let playing = false

  function ensureCtx(): AudioContext | null {
    if (ctx) return ctx
    const Ctor = audioCtor()
    if (!Ctor) return null
    try {
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = ringVolume() * MAX_GAIN
      master.connect(ctx.destination)
    } catch {
      return null
    }
    return ctx
  }

  /** One double-ring burst, scheduled ahead on the audio clock so it stays even. */
  function burst() {
    if (!ctx || !master) return
    const t0 = ctx.currentTime
    for (let i = 0; i < 2; i++) {
      const at = t0 + i * (RING_ON + RING_GAP)
      // Per-burst gain so we can hard-envelope the attack/release — a raw
      // oscillator start/stop clicks audibly.
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(1, at + 0.02)
      g.gain.setValueAtTime(1, at + RING_ON - 0.02)
      g.gain.linearRampToValueAtTime(0, at + RING_ON)
      g.connect(master)

      for (const hz of TONE_HZ) {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = hz
        osc.connect(g)
        osc.start(at)
        osc.stop(at + RING_ON)
      }
    }
  }

  // A ring in progress follows the slider, so an agent who finds it too loud can
  // fix it mid-ring rather than after the call.
  const unsubscribe = onRingVolumeChange(v => {
    if (master && ctx) master.gain.setTargetAtTime(v * MAX_GAIN, ctx.currentTime, 0.02)
  })

  return {
    /** 0–1, applied immediately. Persisting the choice is the caller's job. */
    setVolume(volume: number) {
      if (master && ctx) master.gain.setTargetAtTime(clamp01(volume) * MAX_GAIN, ctx.currentTime, 0.02)
    },

    start() {
      if (playing || ringMuted()) return
      const c = ensureCtx()
      if (!c) return
      playing = true

      const run = () => {
        burst()
        timer = setInterval(burst, RING_CYCLE * 1000)
      }

      if (c.state === 'suspended') {
        // No gesture yet. Try to resume; if the browser refuses, arm a one-shot
        // listener so the ring starts the moment the agent touches the page.
        c.resume().then(
          () => { if (playing) run() },
          () => {
            const onGesture = () => {
              document.removeEventListener('pointerdown', onGesture)
              document.removeEventListener('keydown', onGesture)
              if (!playing) return
              c.resume().then(() => { if (playing) run() }, () => {})
            }
            document.addEventListener('pointerdown', onGesture, { once: true })
            document.addEventListener('keydown', onGesture, { once: true })
          }
        )
        return
      }
      run()
    },

    stop() {
      playing = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      // Oscillators are all short and self-stopping, so there's nothing to tear
      // down — the next scheduled burst simply never gets queued.
    },

    dispose() {
      this.stop()
      unsubscribe()
      ctx?.close().catch(() => {})
      ctx = null
      master = null
    },
  }
}

// --- Preview ---------------------------------------------------------------
// One reused context: audio contexts are a limited per-page resource, and the
// slider can be dragged a lot.
let previewCtx: AudioContext | null = null

/**
 * A single ring burst at the given level, so setting the volume doesn't mean
 * guessing and waiting for a real call. Silent at 0, and never throws.
 */
export function playRingPreview(volume: number): void {
  const v = clamp01(volume)
  if (v === 0) return
  const Ctor = audioCtor()
  if (!Ctor) return
  try {
    if (!previewCtx) previewCtx = new Ctor()
    const c = previewCtx
    const play = () => {
      const at = c.currentTime + 0.02
      const g = c.createGain()
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(v * MAX_GAIN, at + 0.02)
      g.gain.setValueAtTime(v * MAX_GAIN, at + RING_ON - 0.02)
      g.gain.linearRampToValueAtTime(0, at + RING_ON)
      g.connect(c.destination)
      for (const hz of TONE_HZ) {
        const osc = c.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = hz
        osc.connect(g)
        osc.start(at)
        osc.stop(at + RING_ON)
      }
    }
    if (c.state === 'suspended') c.resume().then(play, () => {})
    else play()
  } catch {
    // No audio available — the slider still sets the level for real calls.
  }
}
