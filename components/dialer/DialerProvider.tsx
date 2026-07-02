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
import { Mic, MicOff, Phone, PhoneOff, Loader2, Ban, Check, Grid3x3, Voicemail } from 'lucide-react'
import { toast } from 'sonner'

export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'wrapup'

export interface StartCallArgs {
  phone: string
  leadId?: string
  name?: string
}

interface DialerContextValue {
  startCall: (args: StartCallArgs) => Promise<void>
  hangup: () => void
  sendDigit: (digit: string) => void
  state: CallState
  ready: boolean
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

export function DialerProvider({ children }: { children: React.ReactNode }) {
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)
  const leadIdRef = useRef<string | null>(null)
  const callSidRef = useRef<string | null>(null)
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  const [callee, setCallee] = useState<{ name?: string; phone: string } | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [saving, setSaving] = useState(false)

  // Lazily create + register the Device, refreshing the token on expiry.
  const ensureDevice = useCallback(async (): Promise<Device> => {
    if (deviceRef.current) return deviceRef.current
    const token = await fetchToken()
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
    deviceRef.current = device
    return device
  }, [])

  // Fully reset to idle (after wrap-up, or for non-lead calls / failures).
  const cleanupCall = useCallback(() => {
    callRef.current = null
    leadIdRef.current = null
    callSidRef.current = null
    setMuted(false)
    setCallee(null)
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
    async ({ phone, leadId, name }: StartCallArgs) => {
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
          params: { To: phone, leadId: leadId || '' },
        })
        callRef.current = call

        // Capture the parent CallSid so the wrap-up disposition can be attached to the
        // same voice_calls row the status webhook writes.
        const grabSid = () => {
          const sid = (call.parameters as Record<string, string> | undefined)?.CallSid
          if (sid) callSidRef.current = sid
        }
        call.on('ringing', () => { grabSid(); setState('ringing') })
        call.on('accept', () => { grabSid(); setState('active') })
        call.on('disconnect', endCall)
        call.on('cancel', endCall)
        call.on('reject', () => {
          toast.error('Call was rejected.')
          endCall()
        })
        call.on('error', (e: { message?: string }) => {
          // A call that fails/drops before the client answers surfaces here rather than as a
          // clean 'disconnect'. Still route to wrap-up (via endCall) so the agent can log the
          // attempt — "no answer", "do not call", a note — instead of losing it to idle.
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
    async (d: { interested: 'yes' | 'no' | 'maybe' | null; voicemail: boolean; doNotCall: boolean; notes: string }) => {
      setSaving(true)
      try {
        const res = await fetch('/api/voice/twilio/disposition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callSid: callSidRef.current,
            leadId: leadIdRef.current,
            interested: d.interested,
            voicemail: d.voicemail,
            doNotCall: d.doNotCall,
            notes: d.notes,
          }),
        })
        if (!res.ok) throw new Error(`Save failed (${res.status})`)
        toast.success('Call outcome saved.')
      } catch (e) {
        toast.error((e as Error).message || 'Could not save the outcome.')
      } finally {
        setSaving(false)
        cleanupCall()
      }
    },
    [cleanupCall]
  )

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

  return (
    <DialerContext.Provider value={{ startCall, hangup, sendDigit, state, ready }}>
      {children}
      {state === 'wrapup' ? (
        <DispositionForm
          name={callee?.name || callee?.phone}
          saving={saving}
          onSave={submitDisposition}
          onSkip={cleanupCall}
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

type Interest = 'yes' | 'maybe' | 'no'
const OUTCOMES: { key: Interest; label: string; cls: string }[] = [
  { key: 'yes',   label: 'Interested',     cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  { key: 'maybe', label: 'Maybe',          cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  { key: 'no',    label: 'Not interested', cls: 'border-red-500/40 bg-red-500/10 text-red-300' },
]

/** Post-call wrap-up: agent logs the outcome + notes for the lead they just called. */
function DispositionForm({
  name,
  saving,
  onSave,
  onSkip,
}: {
  name?: string
  saving: boolean
  onSave: (d: { interested: Interest | null; voicemail: boolean; doNotCall: boolean; notes: string }) => void
  onSkip: () => void
}) {
  const [interested, setInterested] = useState<Interest | null>(null)
  const [voicemail, setVoicemail] = useState(false)
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
                if (next) setVoicemail(false) // reached a human → not a voicemail
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
              if (next) setInterested(null) // went to voicemail → no interest gauged
              return next
            })
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            voicemail ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Voicemail size={12} /> Voicemail
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
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-40"
        >
          Skip
        </button>
        <button
          onClick={() => onSave({ interested, voicemail, doNotCall, notes: notes.trim() })}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white
                     transition-colors hover:bg-orange-400 disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Save
        </button>
      </div>
    </div>
  )
}
