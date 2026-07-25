'use client'
import { useState, useEffect } from 'react'
import { MailX, CheckCircle, AlertCircle } from 'lucide-react'

// Admin kill switch for every email the CRM sends on its own — the scheduled-email
// queue, the 5-day follow-up drip, the nightly dialer report, the cold-outreach email
// after an AI voice call, and the internal demo/payment alerts. Manual sends from
// Compose, contracts and client invites are unaffected.
// Reads/writes app_settings.automated_email_enabled via /api/settings/automated-email.
export function AutomatedEmailSetting() {
  const [enabled, setEnabled]   = useState(false)
  const [envOff, setEnvOff]     = useState(false)
  const [queued, setQueued]     = useState(0)
  const [loaded, setLoaded]     = useState(false)
  const [saving, setSaving]     = useState(false)
  const [result, setResult]     = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/automated-email')
      .then(r => r.json())
      .then(d => {
        setEnabled(!!d?.enabled)
        setEnvOff(!!d?.envForcedOff)
        setQueued(Number(d?.queued) || 0)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  async function toggle() {
    const next = !enabled
    setSaving(true)
    setResult(null)
    const res = await fetch('/api/settings/automated-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setEnabled(!!data.enabled)
      setResult({
        ok: true,
        msg: data.enabled
          ? 'Automated emails are back on.'
          : 'Automated emails stopped.',
      })
    } else {
      setResult({ ok: false, msg: data.error || 'Failed to save.' })
    }
  }

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <MailX className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Automated Emails</h2>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        Master switch for every email the CRM sends by itself: the scheduled-email queue,
        the 5-day follow-up drip, the nightly dialer report, the cold-outreach email after
        an AI voice call, and the internal demo &amp; payment alerts. Emails you send by
        hand — Compose, contracts, client invites — are never affected.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={toggle}
          disabled={saving || !loaded || envOff}
          role="switch"
          aria-checked={enabled}
          aria-label="Automated emails"
          className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${enabled ? 'bg-orange-500' : 'bg-white/10'}`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${enabled ? 'left-[26px]' : 'left-0.5'}`}
          />
        </button>
        <span className="text-sm text-slate-300">
          {!loaded ? 'Loading…' : enabled ? 'Sending automatically' : 'Stopped — nothing goes out automatically'}
        </span>
        {result && (
          <span className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
            {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {result.msg}
          </span>
        )}
      </div>

      {loaded && envOff && (
        <p className="text-xs text-amber-400 mt-3">
          Forced off by the AUTOMATED_EMAIL=off environment variable on the server. Remove it
          there before this switch can turn anything back on.
        </p>
      )}

      {loaded && !enabled && queued > 0 && (
        <p className="text-xs text-amber-400 mt-3">
          {queued} scheduled {queued === 1 ? 'email is' : 'emails are'} still queued. They stay
          put while this is off and will send within a minute of turning it back on — clear them
          from the lead&apos;s Email tab first if you don&apos;t want them going out.
        </p>
      )}
    </div>
  )
}
