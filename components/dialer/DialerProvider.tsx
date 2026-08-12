'use client'

/**
 * Browser softphone for the Twilio dialer.
 *
 * Mounted once in the dashboard shell so a live call survives page navigation. Manages
 * the Twilio Voice Device lifecycle (lazy token fetch → connect → in-call controls) and
 * renders a floating call widget. Any component can start a call via useDialer().startCall.
 *
 * The Device is created lazily on the first call so we don't request the microphone on
 * every page load. The access token is refreshed automatically before it expires.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Call, Device } from '@twilio/voice-sdk'
import { Mic, MicOff, Phone, PhoneOff, PhoneIncoming, PhoneMissed, Loader2, Ban, Check, Grid3x3, Voicemail, Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { LogCallModal } from '@/components/leads/LogCallModal'
import { createRingtone, ringMuted, setRingMuted } from '@/lib/voice/ringtone'

export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'wrapup' | 'incoming'

export interface StartCallArgs {
  phone: string
  leadId?: string
  name?: string
  /**
   * caller_numbers id to place the call from ("Call from" in the pre-call modal).
   * Omit to let the server rotate the pool automatically — the normal case.
   */
  callerNumberId?: string
}

interface DialerContextValue {
  startCall: (args: StartCallArgs) => Promise<void>
  hangup: () => void
  sendDigit: (digit: string) => void
  state: CallState
  ready: boolean
}

/** Who's calling in, resolved server-side by /api/voice/twilio/incoming. */
interface IncomingInfo {
  leadId: string | null
  name: string | null
  phone: string
  /** Which of our business lines they dialed (caller_numbers.label), for the greeting. */
  lineName: string | null
  /** The number they dialed, shown when that line has no label. */
  toPhone: string | null
}

const DialerContext = createContext<DialerContextValue | null>(null)

export function useDialer(): DialerContextValue {
  const ctx = useContext(DialerContext)
  if (!ctx) throw new Error('useDialer must be used within <DialerProvider>')
  return ctx
}

async function fetchToken(): Promise<string> {
  const res = await fetch('/api/voice/twilio/token')
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.token) {
    throw new Error(data.error || 'Could not get a calling token')
  }
  return data.token as string
}

/** Caller details the server attached to the <Client> leg, for either incoming slot. */
function readIncomingInfo(call: Call): IncomingInfo {
  const p = call.customParameters
  const params = call.parameters as Record<string, string> | undefined
  return {
    leadId: p?.get('leadId') || null,
    name: p?.get('leadName') || null,
    phone: params?.From || '',
    lineName: p?.get('lineName') || null,
    // On a <Client> leg To is our client identity, not the dialed number, so the
    // number we fall back to has to come from the server too.
    toPhone: p?.get('toPhone') || null,
  }
}

export function DialerProvider({ children }: { children: React.ReactNode }) {
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)
  const leadIdRef = useRef<string | null>(null)
  const callSidRef = useRef<string | null>(null)
  // The ringing inbound call, held until the agent accepts or rejects it.
  const incomingRef = useRef<Call | null>(null)
  // A call that arrives while the agent is already busy. Kept in its own slot rather
  // than `incoming` because it has to coexist with the live call instead of replacing
  // it — `state` can only describe one call at a time.
  const secondRef = useRef<Call | null>(null)
  const [second, setSecond] = useState<IncomingInfo | null>(null)
  // Lead whose wrap-up we owe once the dust settles. Set when a live call is cut short
  // to take another one: its disposition form would be buried under the new call, so
  // we hold the lead and open the log form when we're back to idle.
  const [queuedLog, setQueuedLog] = useState<string | null>(null)
  // Indirection so the Device's 'incoming' listener — attached once, at Device
  // creation — always runs the latest handler instead of a stale closure.
  const onIncomingRef = useRef<(call: Call) => void>(() => {})
  const [incoming, setIncoming] = useState<IncomingInfo | null>(null)
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  const [callee, setCallee] = useState<{ name?: string; phone: string } | null>(null)
  const [seconds, setSeconds] = useState(0)
  // When set, the shared Log Call modal opens after the wrap-up (same form as the
  // lead's Calls & Apps tab) so the agent can log the call + schedule a callback.
  const [logCall, setLogCall] = useState<{ leadId: string; notes: string } | null>(null)

  // Lazily create + register the Device, refreshing the token on expiry.
  const ensureDevice = useCallback(async (): Promise<Device> => {
    // Always mint a fresh token first. The DialerProvider is mounted for the life of the
    // page, so on a long-lived tab the cached Device may be holding an expired token — the
    // background `tokenWillExpire` refresh can be throttled (backgrounded tab) or fail
    // silently (lapsed session). Handing the Device a fresh token on every call attempt
    // guarantees we never dial with a stale JWT → Twilio error 20104 (AccessTokenExpired).
    const token = await fetchToken()
    if (deviceRef.current) {
      deviceRef.current.updateToken(token)
      return deviceRef.current
    }
    const device = new Device(token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    })
    device.on('tokenWillExpire', async () => {
      try {
        device.updateToken(await fetchToken())
      } catch (e) {
        console.error('[dialer] token refresh failed', e)
      }
    })
    device.on('error', (e: { message?: string }) => {
      console.error('[dialer] device error', e)
      toast.error(e?.message || 'Dialer error')
    })
    device.on('incoming', (call: Call) => onIncomingRef.current(call))
    deviceRef.current = device
    return device
  }, [])

  // Fully reset to idle (after wrap-up, or for non-lead calls / failures).
  const cleanupCall = useCallback(() => {
    callRef.current = null
    leadIdRef.current = null
    callSidRef.current = null
    incomingRef.current = null
    setMuted(false)
    setCallee(null)
    setIncoming(null)
    setState('idle')
    setSeconds(0)
  }, [])

  // A call ended. If it was tied to a lead, drop into the wrap-up form so the agent can
  // log an outcome; otherwise reset straight to idle.
  const endCall = useCallback(() => {
    callRef.current = null
    setMuted(false)
    if (leadIdRef.current) {
      setState('wrapup')
    } else {
      cleanupCall()
    }
  }, [cleanupCall])

  const startCall = useCallback(
    async ({ phone, leadId, name, callerNumberId }: StartCallArgs) => {
      if (state !== 'idle') {
        toast.error('A call is already in progress.')
        return
      }
      if (!phone) {
        toast.error('No phone number on file for this lead.')
        return
      }
      leadIdRef.current = leadId || null
      callSidRef.current = null
      setCallee({ name, phone })
      setState('connecting')
      try {
        const device = await ensureDevice()
        const call = await device.connect({
          params: {
            To: phone,
            leadId: leadId || '',
            // Empty string = auto-select. The TwiML route validates this id against the
            // active pool, so it can't be used to dial from an arbitrary number.
            callerNumberId: callerNumberId || '',
          },
        })
        callRef.current = call

        // Capture the parent CallSid so the wrap-up disposition can be attached to the
        // same voice_calls row the status webhook writes.
        const grabSid = () => {
          const sid = (call.parameters as Record<string, string> | undefined)?.CallSid
          if (sid) callSidRef.current = sid
        }
        // Every terminal handler is guarded on identity: when the agent cuts this call
        // short to take an inbound one, we hand callRef to the new call and *then*
        // disconnect this one. Ungarded, that disconnect would run endCall and drop the
        // call we just answered into the wrap-up form.
        const isCurrent = () => callRef.current === call
        call.on('ringing', () => { if (!isCurrent()) return; grabSid(); setState('ringing') })
        call.on('accept', () => { if (!isCurrent()) return; grabSid(); setState('active') })
        call.on('disconnect', () => { if (isCurrent()) endCall() })
        call.on('cancel', () => { if (isCurrent()) endCall() })
        call.on('reject', () => {
          if (!isCurrent()) return
          toast.error('Call was rejected.')
          endCall()
        })
        call.on('error', (e: { message?: string }) => {
          // A call that fails/drops before the client answers surfaces here rather than as a
          // clean 'disconnect'. Still route to wrap-up (via endCall) so the agent can log the
          // attempt — "no answer", "do not call", a note — instead of losing it to idle.
          if (!isCurrent()) return
          toast.error(e?.message || 'Call failed.')
          endCall()
        })
      } catch (err) {
        const msg = (err as Error).message || 'Could not start the call.'
        // A blocked mic is the usual culprit.
        toast.error(/permission|denied|getusermedia/i.test(msg) ? 'Microphone access is blocked. Allow it and retry.' : msg)
        cleanupCall()
      }
    },
    [state, ensureDevice, cleanupCall, endCall]
  )

  // ── Inbound: a lead is calling one of our pool numbers back ────────────────
  // The server (/api/voice/twilio/incoming) has already resolved which lead this is
  // and rung the agent who last called them; we just present it. In a hunt group
  // several browsers ring at once, so 'cancel' (another agent got there first, or
  // the caller gave up) has to reset us cleanly.
  useEffect(() => {
    onIncomingRef.current = (call: Call) => {
      // Busy — but the call is still offered rather than declined. It arrives as a
      // silent card next to the live call: no ringtone (the agent is mid-conversation
      // and the far end would hear it), and it never covers the call controls. The leg
      // is left open so Answer is a real option; ignoring it simply lets Twilio's
      // <Dial timeout> roll the caller on to the rest of the team as before.
      if (callRef.current || state !== 'idle' || secondRef.current) {
        // One at a time. A third caller during all this gets today's behaviour —
        // declined so they escalate immediately, rather than stacking cards nobody
        // can act on.
        if (secondRef.current) {
          call.reject()
          return
        }

        secondRef.current = call
        setSecond(readIncomingInfo(call))

        const gone = () => {
          if (secondRef.current !== call) return
          secondRef.current = null
          setSecond(null)
        }
        call.on('cancel', gone)
        call.on('reject', gone)
        call.on('disconnect', gone)
        call.on('error', (e: { message?: string }) => {
          console.error('[dialer] second incoming call error', e)
          gone()
        })
        return
      }

      incomingRef.current = call
      setIncoming(readIncomingInfo(call))
      setState('incoming')

      const dropped = () => {
        // Only reset if this is still the call we're showing — a late event from a
        // superseded call must not tear down a live one.
        if (incomingRef.current === call) cleanupCall()
      }
      call.on('cancel', dropped)
      call.on('reject', dropped)
      call.on('disconnect', () => {
        if (callRef.current === call) endCall()
        else dropped()
      })
      call.on('error', (e: { message?: string }) => {
        console.error('[dialer] incoming call error', e)
        dropped()
      })
    }
  }, [state, cleanupCall, endCall])

  // Register the Device on mount so inbound calls can reach this browser at all.
  // Registering only opens the signalling websocket — the microphone isn't touched
  // until a call is actually accepted, so this doesn't prompt for permissions.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const device = await ensureDevice()
        if (!cancelled) await device.register()
      } catch (e) {
        // Not fatal: outbound still works, this browser just won't receive calls.
        console.error('[dialer] could not register for incoming calls', e)
      }
    })()
    return () => { cancelled = true }
  }, [ensureDevice])

  const acceptIncoming = useCallback(() => {
    const call = incomingRef.current
    if (!call) return
    callRef.current = call
    incomingRef.current = null
    leadIdRef.current = incoming?.leadId || null
    setCallee({ name: incoming?.name || undefined, phone: incoming?.phone || '' })
    setIncoming(null)
    call.on('accept', () => {
      const sid = (call.parameters as Record<string, string> | undefined)?.CallSid
      if (sid) callSidRef.current = sid
      setState('active')
    })
    call.accept()
  }, [incoming])

  const rejectIncoming = useCallback(() => {
    const call = incomingRef.current
    // Rejecting frees the hunt group to keep ringing the rest of the team.
    call?.reject()
    cleanupCall()
  }, [cleanupCall])

  /**
   * Take the second call, cutting the current one short.
   *
   * Order matters: promote the new call to callRef *before* disconnecting the old one,
   * so the old call's identity-guarded handlers see they're no longer current and skip
   * endCall. The interrupted lead's wrap-up is queued rather than shown — the form
   * would land on top of the call we just answered.
   */
  const acceptSecond = useCallback(() => {
    const call = secondRef.current
    if (!call) return
    const previous = callRef.current
    // Read before we overwrite it. There may be no live call and still a lead owed a
    // log — answering straight out of the wrap-up form would otherwise drop it.
    const previousLead = leadIdRef.current

    callRef.current = call
    secondRef.current = null
    leadIdRef.current = second?.leadId || null
    callSidRef.current = null
    setCallee({ name: second?.name || undefined, phone: second?.phone || '' })
    setSecond(null)
    setMuted(false)
    setSeconds(0)
    // Move off the outgoing call's state immediately — left on 'wrapup' this would show
    // a disposition form labelled with the caller we've just picked up.
    setState('connecting')
    if (previousLead) setQueuedLog(previousLead)

    call.on('accept', () => {
      const sid = (call.parameters as Record<string, string> | undefined)?.CallSid
      if (sid) callSidRef.current = sid
      setState('active')
    })
    // The slot handlers attached at arrival only clear the card, so this call still
    // needs the primary-call teardown now that it owns callRef.
    call.on('disconnect', () => { if (callRef.current === call) endCall() })
    call.accept()

    if (previous) {
      // Just this leg — disconnectAll() would take the call we're answering with it.
      previous.disconnect()
      toast('Previous call ended. You can log it when this one wraps up.')
    }
  }, [second, endCall])

  const declineSecond = useCallback(() => {
    const call = secondRef.current
    secondRef.current = null
    setSecond(null)
    // Declining frees the hunt group to keep ringing the rest of the team.
    call?.reject()
  }, [])

  const hangup = useCallback(() => {
    // Disconnecting fires the call's 'disconnect' handler (endCall), which routes to the
    // wrap-up form when there's a lead. If there's no live call, end directly.
    if (callRef.current) {
      callRef.current.disconnect()
      deviceRef.current?.disconnectAll()
    } else {
      endCall()
    }
  }, [endCall])

  const submitDisposition = useCallback(
    (d: { interested: 'yes' | 'no' | 'maybe' | null; voicemail: boolean; hangup: boolean; doNotCall: boolean; notes: string }) => {
      const leadId = leadIdRef.current
      const callSid = callSidRef.current

      // Close the wrap-up and open the full Log Call form straight away. Every Save
      // leads to it — whatever the chips say, notes or not — and opening before the
      // POST means a slow or failing request can't delay (or swallow) the modal.
      cleanupCall()
      if (leadId) setLogCall({ leadId, notes: d.notes })

      // The outcome save continues in the background; it only toasts.
      fetch('/api/voice/twilio/disposition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callSid,
          leadId,
          interested: d.interested,
          voicemail: d.voicemail,
          hangup: d.hangup,
          doNotCall: d.doNotCall,
          notes: d.notes,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Save failed (${res.status})`)
          toast.success('Call outcome saved.')
        })
        .catch((e: Error) => toast.error(e.message || 'Could not save the outcome.'))
    },
    [cleanupCall]
  )

  // Skip the wrap-up chips but still offer the full Log Call form (empty notes are
  // fine) — the agent can Cancel it if there's truly nothing to log.
  const skipWrapup = useCallback(() => {
    const leadId = leadIdRef.current
    cleanupCall()
    if (leadId) setLogCall({ leadId, notes: '' })
  }, [cleanupCall])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    const next = !muted
    call.mute(next)
    setMuted(next)
  }, [muted])

  // Send DTMF tones over the live call so the agent can navigate the lead's phone menu
  // ("press 9 for sales"). Twilio plays the tone on the far end; no-op if no live call.
  const sendDigit = useCallback((digit: string) => {
    callRef.current?.sendDigits(digit)
  }, [])

  // Tick the in-call timer while a call is live.
  useEffect(() => {
    if (state !== 'active') return
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [state])

  // Destroy the Device when the provider unmounts (logout / app close).
  useEffect(() => {
    return () => {
      deviceRef.current?.destroy()
      deviceRef.current = null
    }
  }, [])

  const ready = state === 'idle'

  // The call just finished takes precedence; the lead whose call we cut short to take
  // another one waits behind it, and only surfaces once the dialer is quiet. Derived
  // rather than pushed into `logCall`, so there's one source of truth for what's owed.
  const activeLog = logCall ?? (state === 'idle' && queuedLog ? { leadId: queuedLog, notes: '' } : null)

  return (
    <DialerContext.Provider value={{ startCall, hangup, sendDigit, state, ready }}>
      {children}
      {state === 'incoming' ? (
        <IncomingCallWidget
          info={incoming}
          onAccept={acceptIncoming}
          onReject={rejectIncoming}
        />
      ) : state === 'wrapup' ? (
        <DispositionForm
          name={callee?.name || callee?.phone}
          onSave={submitDisposition}
          onSkip={skipWrapup}
        />
      ) : state !== 'idle' ? (
        <CallWidget
          state={state}
          muted={muted}
          callee={callee}
          seconds={seconds}
          onMute={toggleMute}
          onHangup={hangup}
          onDigit={sendDigit}
        />
      ) : null}
      {/* Outside the ternary above: this one has to sit *alongside* whatever the live
          call is showing, not replace it. */}
      {second && (
        <SecondCallCard
          info={second}
          busy={state === 'active' || state === 'ringing' || state === 'connecting'}
          onAccept={acceptSecond}
          onDecline={declineSecond}
        />
      )}
      {activeLog && (
        <LogCallModal
          // Remount per lead: closing one form and revealing a queued one must not
          // carry the first lead's typed notes across.
          key={activeLog.leadId}
          open
          onClose={() => {
            // Close whichever is showing; a queued wrap-up takes its place next render.
            if (logCall) setLogCall(null)
            else setQueuedLog(null)
          }}
          leadId={activeLog.leadId}
          initialNotes={activeLog.notes}
        />
      )}
    </DialerContext.Provider>
  )
}

function fmt(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

function statusLabel(state: CallState): string {
  switch (state) {
    case 'connecting': return 'Connecting…'
    case 'ringing': return 'Ringing…'
    case 'active': return 'In call'
    default: return ''
  }
}

const KEYPAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
]

function CallWidget({
  state,
  muted,
  callee,
  seconds,
  onMute,
  onHangup,
  onDigit,
}: {
  state: CallState
  muted: boolean
  callee: { name?: string; phone: string } | null
  seconds: number
  onMute: () => void
  onHangup: () => void
  onDigit: (digit: string) => void
}) {
  const connecting = state === 'connecting' || state === 'ringing'
  const [keypadOpen, setKeypadOpen] = useState(false)
  const [sent, setSent] = useState('')

  const press = (d: string) => {
    onDigit(d)
    setSent((s) => (s + d).slice(-20))
  }

  return (
    <div
      role="dialog"
      aria-label="Active call"
      className="fixed bottom-5 right-5 z-[100] w-72 rounded-2xl border border-slate-700 bg-[#0E0B24] p-4 shadow-2xl shadow-black/40"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/15 text-orange-300">
          {connecting ? <Loader2 size={18} className="animate-spin" /> : <Phone size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {callee?.name || callee?.phone || 'Unknown'}
          </p>
          <p className="truncate text-xs text-slate-400">
            {callee?.name ? callee.phone : statusLabel(state)}
          </p>
        </div>
        <span className="text-xs tabular-nums text-slate-400">
          {state === 'active' ? fmt(seconds) : statusLabel(state)}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          onClick={onMute}
          disabled={state !== 'active'}
          title={muted ? 'Unmute' : 'Mute'}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 text-slate-200
                     transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          onClick={() => setKeypadOpen((v) => !v)}
          disabled={state !== 'active'}
          title="Keypad"
          aria-pressed={keypadOpen}
          className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-slate-200
                     transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 ${
                       keypadOpen ? 'border-orange-500 bg-orange-500/15 text-orange-300' : 'border-slate-700'
                     }`}
        >
          <Grid3x3 size={18} />
        </button>
        <button
          onClick={onHangup}
          title="Hang up"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white
                     transition-colors hover:bg-red-500"
        >
          <PhoneOff size={20} />
        </button>
      </div>

      {keypadOpen && state === 'active' ? (
        <div className="mt-4 border-t border-slate-700 pt-3">
          <div className="mb-2 h-5 truncate text-center text-sm tabular-nums tracking-widest text-slate-300">
            {sent}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYPAD_ROWS.flat().map((d) => (
              <button
                key={d}
                onClick={() => press(d)}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-700 text-base font-semibold
                           text-slate-100 transition-colors hover:bg-slate-800 active:bg-slate-700"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Ringing inbound call — a centred, full-screen modal with a ringtone.
 *
 * Deliberately the loudest surface in the app: it appears while the agent is doing
 * something else and there are only ~15 seconds before the call rolls on to the rest
 * of the team. Because the hunt group rings several browsers at once, this can vanish
 * on its own the moment a colleague answers (the 'cancel' handler in DialerProvider).
 *
 * Escape declines, so a misdirected call can be cleared from the keyboard.
 */
function IncomingCallWidget({
  info,
  onAccept,
  onReject,
}: {
  info: IncomingInfo | null
  onAccept: () => void
  onReject: () => void
}) {
  const [muted, setMuted] = useState(false)
  const answerRef = useRef<HTMLButtonElement | null>(null)
  const ringRef = useRef<ReturnType<typeof createRingtone> | null>(null)

  // Ring for as long as this modal is mounted. The ringtone object is per-mount:
  // an inbound call is rare enough that building one AudioContext per ring is fine,
  // and it guarantees we never leak a running interval between calls.
  useEffect(() => {
    setMuted(ringMuted())
    const ring = createRingtone()
    ringRef.current = ring
    ring.start()
    return () => {
      ring.dispose()
      ringRef.current = null
    }
  }, [])

  // Focus Answer so Enter picks up — the agent may be typing when this appears.
  useEffect(() => {
    answerRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReject()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onReject])

  // Muting stops the current ring and persists for future calls in this browser.
  const toggleRing = useCallback(() => {
    const next = !muted
    setMuted(next)
    setRingMuted(next)
    if (next) ringRef.current?.stop()
    else ringRef.current?.start()
  }, [muted])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      // Backdrop clicks are ignored on purpose: a stray click must never drop a call.
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Incoming call"
        className="w-full max-w-sm rounded-3xl border border-emerald-500/40 bg-[#0E0B24] p-8 text-center shadow-2xl shadow-black/60"
      >
        <span className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          <PhoneIncoming size={32} className="relative" />
        </span>

        {/* Which line was dialed, as a badge. Sits above the caller because it decides
            the greeting — the agent reads it first, in the second before answering. */}
        <p className="mt-5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/40
                      bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
          <PhoneIncoming size={12} className="shrink-0" />
          <span className="truncate">
            {info?.lineName || (info?.toPhone ? `Call to ${info.toPhone}` : 'Incoming call')}
          </span>
        </p>
        <p className="mt-2 truncate text-2xl font-bold text-slate-50">
          {info?.name || info?.phone || 'Unknown caller'}
        </p>
        {info?.name ? (
          <p className="mt-1 truncate text-sm tabular-nums text-slate-400">{info.phone}</p>
        ) : null}
        {!info?.leadId && (
          <p className="mt-2 text-xs text-slate-500">Not matched to a lead in the CRM.</p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={onReject}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 py-3.5
                       text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            <PhoneOff size={17} /> Decline
          </button>
          <button
            ref={answerRef}
            onClick={onAccept}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-sm
                       font-semibold text-white transition-colors hover:bg-emerald-500
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2
                       focus-visible:ring-offset-[#0E0B24]"
          >
            <Phone size={17} /> Answer
          </button>
        </div>

        <button
          onClick={toggleRing}
          className="mt-4 inline-flex items-center justify-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          {muted ? 'Ringtone off for this browser' : 'Mute ringtone'}
        </button>
      </div>
    </div>
  )
}

/**
 * A call that arrived while the agent was already on one.
 *
 * Deliberately the quietest surface in the app, the inverse of IncomingCallWidget: no
 * ringtone (the agent is mid-conversation and their mic would carry it to the far end),
 * no backdrop, no modal focus trap, and no Escape binding — a reflexive keystroke must
 * not drop a caller. It sits top-right because the live-call dock and the toasts both
 * own the bottom-right corner.
 *
 * The leg stays open behind this card, so it disappears on its own the moment a
 * colleague picks up or the caller rolls to voicemail.
 */
function SecondCallCard({
  info,
  busy,
  onAccept,
  onDecline,
}: {
  info: IncomingInfo
  busy: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  const [armed, setArmed] = useState(false)

  // Answering mid-call hangs up a live conversation, so it takes a second, deliberate
  // click. The confirm lapses on its own — a card that sat armed for a minute would
  // turn a later glance-and-click into a dropped call.
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 5000)
    return () => clearTimeout(id)
  }, [armed])

  const answer = () => {
    if (busy && !armed) {
      setArmed(true)
      return
    }
    onAccept()
  }

  return (
    <div
      role="dialog"
      aria-label="Another incoming call"
      className="fixed right-5 top-5 z-[110] w-72 rounded-2xl border border-emerald-500/40 bg-[#0E0B24] p-4 shadow-2xl shadow-black/50"
    >
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          <PhoneIncoming size={16} className="relative" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {info.name || info.phone || 'Unknown caller'}
          </p>
          <p className="truncate text-xs text-slate-400">
            {info.name ? info.phone : info.lineName || (info.toPhone ? `Call to ${info.toPhone}` : 'Incoming')}
          </p>
        </div>
      </div>

      {info.name && (info.lineName || info.toPhone) ? (
        <p className="mt-2 truncate text-xs text-emerald-300/80">
          {info.lineName || `Call to ${info.toPhone}`}
        </p>
      ) : null}
      {!info.leadId && (
        <p className="mt-2 text-xs text-slate-500">Not matched to a lead in the CRM.</p>
      )}

      <p className="mt-2 text-xs text-slate-500">
        {armed
          ? 'Answering will hang up your current call. Click again to confirm.'
          : busy
            ? 'Also ringing the rest of the team.'
            : 'Ringing you now.'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onDecline}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 py-2
                     text-xs font-semibold text-slate-300 transition-colors hover:bg-slate-800"
        >
          <PhoneOff size={14} /> Decline
        </button>
        <button
          onClick={answer}
          className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold
                      text-white transition-colors ${
                        armed ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
                      }`}
        >
          <Phone size={14} /> {armed ? 'End call & answer' : 'Answer'}
        </button>
      </div>
    </div>
  )
}

type Interest = 'yes' | 'maybe' | 'no'
const OUTCOMES: { key: Interest; label: string; cls: string }[] = [
  { key: 'yes',   label: 'Interested',     cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  { key: 'maybe', label: 'Maybe',          cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  { key: 'no',    label: 'Not interested', cls: 'border-red-500/40 bg-red-500/10 text-red-300' },
]

/** Post-call wrap-up: agent logs the outcome + notes for the lead they just called. */
function DispositionForm({
  name,
  onSave,
  onSkip,
}: {
  name?: string
  onSave: (d: { interested: Interest | null; voicemail: boolean; hangup: boolean; doNotCall: boolean; notes: string }) => void
  onSkip: () => void
}) {
  const [interested, setInterested] = useState<Interest | null>(null)
  const [voicemail, setVoicemail] = useState(false)
  const [hangup, setHangup] = useState(false)
  const [doNotCall, setDoNotCall] = useState(false)
  const [notes, setNotes] = useState('')

  return (
    <div
      role="dialog"
      aria-label="Call outcome"
      className="fixed bottom-5 right-5 z-[100] w-80 rounded-2xl border border-slate-700 bg-[#0E0B24] p-4 shadow-2xl shadow-black/40"
    >
      <p className="text-sm font-semibold text-slate-100">Log call outcome</p>
      <p className="truncate text-xs text-slate-400">{name || 'Lead'}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            onClick={() =>
              setInterested((v) => {
                const next = v === o.key ? null : o.key
                if (next) { setVoicemail(false); setHangup(false) } // reached a human → not a voicemail/hangup
                return next
              })
            }
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
              interested === o.key ? o.cls : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={() =>
            setVoicemail((v) => {
              const next = !v
              if (next) { setInterested(null); setHangup(false) } // went to voicemail → no interest gauged
              return next
            })
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            voicemail ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Voicemail size={12} /> Voicemail
        </button>
        <button
          onClick={() =>
            setHangup((v) => {
              const next = !v
              if (next) { setInterested(null); setVoicemail(false) } // no pickup / cut the call → nothing else applies
              return next
            })
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            hangup ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          <PhoneMissed size={12} /> Hung up
        </button>
      </div>

      <button
        onClick={() => setDoNotCall((v) => !v)}
        className={`mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          doNotCall ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
        }`}
      >
        <Ban size={12} /> Do not call
      </button>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Notes (optional)…"
        className="mt-3 w-full resize-none rounded-lg border border-slate-700 bg-slate-900 p-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-orange-500 focus:outline-none"
      />

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onSkip}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
        >
          Skip
        </button>
        <button
          onClick={() => onSave({ interested, voicemail, hangup, doNotCall, notes: notes.trim() })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white
                     transition-colors hover:bg-orange-400"
        >
          <Check size={13} />
          Save
        </button>
      </div>
    </div>
  )
}
