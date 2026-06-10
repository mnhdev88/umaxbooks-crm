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
import { Mic, MicOff, Phone, PhoneOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export type CallState = 'idle' | 'connecting' | 'ringing' | 'active' | 'ended'

export interface StartCallArgs {
  phone: string
  leadId?: string
  name?: string
}

interface DialerContextValue {
  startCall: (args: StartCallArgs) => Promise<void>
  hangup: () => void
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
  const [state, setState] = useState<CallState>('idle')
  const [muted, setMuted] = useState(false)
  const [callee, setCallee] = useState<{ name?: string; phone: string } | null>(null)
  const [seconds, setSeconds] = useState(0)

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

  const cleanupCall = useCallback(() => {
    callRef.current = null
    setMuted(false)
    setCallee(null)
    setState('idle')
    setSeconds(0)
  }, [])

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
      setCallee({ name, phone })
      setState('connecting')
      try {
        const device = await ensureDevice()
        const call = await device.connect({
          params: { To: phone, leadId: leadId || '' },
        })
        callRef.current = call

        call.on('ringing', () => setState('ringing'))
        call.on('accept', () => setState('active'))
        call.on('disconnect', cleanupCall)
        call.on('cancel', cleanupCall)
        call.on('reject', () => {
          toast.error('Call was rejected.')
          cleanupCall()
        })
        call.on('error', (e: { message?: string }) => {
          toast.error(e?.message || 'Call failed.')
          cleanupCall()
        })
      } catch (err) {
        const msg = (err as Error).message || 'Could not start the call.'
        // A blocked mic is the usual culprit.
        toast.error(/permission|denied|getusermedia/i.test(msg) ? 'Microphone access is blocked. Allow it and retry.' : msg)
        cleanupCall()
      }
    },
    [state, ensureDevice, cleanupCall]
  )

  const hangup = useCallback(() => {
    callRef.current?.disconnect()
    deviceRef.current?.disconnectAll()
    cleanupCall()
  }, [cleanupCall])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    const next = !muted
    call.mute(next)
    setMuted(next)
  }, [muted])

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
    <DialerContext.Provider value={{ startCall, hangup, state, ready }}>
      {children}
      {state !== 'idle' && (
        <CallWidget
          state={state}
          muted={muted}
          callee={callee}
          seconds={seconds}
          onMute={toggleMute}
          onHangup={hangup}
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
    case 'ended': return 'Call ended'
    default: return ''
  }
}

function CallWidget({
  state,
  muted,
  callee,
  seconds,
  onMute,
  onHangup,
}: {
  state: CallState
  muted: boolean
  callee: { name?: string; phone: string } | null
  seconds: number
  onMute: () => void
  onHangup: () => void
}) {
  const connecting = state === 'connecting' || state === 'ringing'
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
          onClick={onHangup}
          title="Hang up"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white
                     transition-colors hover:bg-red-500"
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  )
}
