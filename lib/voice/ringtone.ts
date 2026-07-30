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

const MUTE_KEY = 'dialer_ring_muted'

/** UK-style double-ring: two 0.4s bursts, then a 2s gap. */
const RING_ON = 0.4
const RING_GAP = 0.2
const RING_CYCLE = 3.0
/** Two tones an octave-ish apart read as a "phone" rather than a test beep. */
const TONE_HZ = [440, 480]
const VOLUME = 0.12

export function ringMuted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'on'
  } catch {
    return false
  }
}

export function setRingMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? 'on' : 'off')
  } catch {
    // Private mode / storage disabled — the setting just won't persist.
  }
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
      master.gain.value = VOLUME
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

  return {
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
      ctx?.close().catch(() => {})
      ctx = null
      master = null
    },
  }
}
