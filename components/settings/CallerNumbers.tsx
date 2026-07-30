'use client'
import { useState, useEffect } from 'react'
import { PhoneOutgoing, PhoneIncoming, PhoneForwarded, Plus, Trash2, ShieldCheck, ShieldAlert, AlertCircle, CheckCircle, X } from 'lucide-react'

// Admin management of the outbound caller-ID pool (caller_numbers). Volume spreads
// across these numbers under per-number daily caps so no single one trips the
// carrier spam filters. Reads/writes via /api/settings/caller-numbers.

interface CallerNumber {
  id: string
  phone_number: string
  label: string | null
  area_code: string | null
  daily_cap: number
  is_active: boolean
  registered: boolean
  /** What a callback does: ring the team, or speak a redirect and hang up (093). */
  inbound_mode: 'full' | 'deflect'
  notes: string | null
}

interface Health {
  calls: number
  answered: number
  conversations: number
  short_calls: number
  avg_sec: number | null
  callbacks: number
}

const EMPTY = { phone_number: '', label: '', daily_cap: 50, registered: false }

/** Pretty-print +19086395666 as +1 (908) 639-5666. */
function fmt(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'
}

export function CallerNumbers() {
  const [numbers, setNumbers]     = useState<CallerNumber[]>([])
  const [usedToday, setUsedToday] = useState<Record<string, number>>({})
  const [health, setHealth]       = useState<Record<string, Health>>({})
  const [envFallback, setEnvFallback] = useState<string | null>(null)
  const [loaded, setLoaded]   = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]       = useState({ ...EMPTY })
  const [saving, setSaving]   = useState(false)
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const res = await fetch('/api/settings/caller-numbers')
    const d = await res.json().catch(() => ({}))
    if (res.ok) {
      setNumbers(d.numbers || [])
      setUsedToday(d.usedToday || {})
      setHealth(d.health || {})
      setEnvFallback(d.envFallback ?? null)
    }
    setLoaded(true)
  }

  async function add() {
    setSaving(true); setResult(null)
    const res = await fetch('/api/settings/caller-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok) {
      setForm({ ...EMPTY }); setShowForm(false)
      setResult({ ok: true, msg: `Added ${fmt(d.number.phone_number)}.` })
      load()
    } else {
      setResult({ ok: false, msg: d.error || 'Failed to add number.' })
    }
  }

  async function patch(id: string, body: Partial<CallerNumber>) {
    // Optimistic — the row flips instantly, then we reconcile with the server.
    setNumbers(ns => ns.map(n => (n.id === id ? { ...n, ...body } : n)))
    const res = await fetch('/api/settings/caller-numbers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setResult({ ok: false, msg: d.error || 'Update failed.' })
      load()
      return
    }
    // Twilio holds the Voice URL per number, so this column alone re-routes nothing.
    // Saying so here is the difference between "toggled it, calls still deflect, no idea
    // why" and a known follow-up step.
    if ('inbound_mode' in body) {
      setResult({
        ok: true,
        msg: 'Saved. Inbound routing only changes once someone runs scripts/set-twilio-voice-webhooks.mjs --run on the server.',
      })
    }
  }

  async function remove(n: CallerNumber) {
    if (!confirm(`Remove ${fmt(n.phone_number)} from the pool?\n\nPast calls keep their record — this only stops new calls using it.`)) return
    const res = await fetch(`/api/settings/caller-numbers?id=${n.id}`, { method: 'DELETE' })
    if (res.ok) { setResult({ ok: true, msg: `Removed ${fmt(n.phone_number)}.` }); load() }
    else setResult({ ok: false, msg: 'Delete failed.' })
  }

  const activeCount = numbers.filter(n => n.is_active).length
  const totalCap = numbers.filter(n => n.is_active).reduce((s, n) => s + n.daily_cap, 0)
  const unregistered = numbers.filter(n => n.is_active && !n.registered).length

  return (
    <div className="bg-[#160E32] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <PhoneOutgoing className="w-4 h-4 text-orange-400" />
        <h2 className="text-slate-100 font-semibold text-lg">Caller Numbers</h2>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        Outbound caller IDs for the dialer. Each call picks the number with the fewest
        calls today, preferring one whose area code matches the lead. Keeping every
        number under its daily cap is what stops carriers labelling them
        &quot;Spam Likely&quot;. With none configured, the dialer falls back to
        the <code className="text-slate-300">TWILIO_CALLER_ID</code> env var
        {envFallback ? <> (<span className="text-slate-300">{fmt(envFallback)}</span>)</> : null}.
      </p>

      {/* amber-500/15 + amber-600/50 + amber-300 all have html.light overrides in
          globals.css; the amber-400/* alpha variants do not. */}
      <div className="bg-amber-500/15 border border-amber-600/50 rounded-lg px-4 py-3 mb-5 text-sm text-slate-300">
        <strong className="text-amber-300">Register before you rotate.</strong> Rotating
        unregistered numbers is the spammer pattern and gets flagged faster than one number
        would. Each number needs Twilio Trust Hub (Attestation A + CNAM) and a submission to
        freecallerregistry.com before it carries real volume.
      </div>

      {loaded && numbers.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4 text-sm">
          <span className="text-slate-400">
            <span className="text-slate-100 font-medium">{activeCount}</span> active
          </span>
          <span className="text-slate-400">
            <span className="text-slate-100 font-medium">{totalCap}</span> calls/day capacity
          </span>
          {unregistered > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" />
              {unregistered} unregistered
            </span>
          )}
        </div>
      )}

      {!loaded ? (
        <p className="text-slate-500 text-sm">Loading…</p>
      ) : numbers.length === 0 ? (
        <p className="text-slate-500 text-sm mb-4">No numbers in the pool yet.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-white/10">
                <th className="pb-2 font-medium">Number</th>
                <th className="pb-2 font-medium">Today</th>
                <th className="pb-2 font-medium">Cap</th>
                <th className="pb-2 font-medium" title="Calls over the last 30 days">30d calls</th>
                <th className="pb-2 font-medium" title="Answered calls lasting 2+ minutes — the best proxy for a real conversation">Convos</th>
                <th className="pb-2 font-medium" title="Answered but under 30s — hang-ups and voicemail. A rising share means the number is being labelled.">Short</th>
                <th className="pb-2 font-medium" title="Inbound calls received on this number over 30 days. Leads calling back is the strongest sign a number is trusted.">Callbacks</th>
                <th className="pb-2 font-medium">Registered</th>
                <th className="pb-2 font-medium" title="What happens when a lead calls this number back. Rings = the owning agent, then the hunt group, then voicemail. Redirect = a spoken message pointing them at the main line.">Inbound</th>
                <th className="pb-2 font-medium">Active</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {numbers.map(n => {
                const used = usedToday[n.phone_number] || 0
                const h = health[n.phone_number]
                const atCap = used >= n.daily_cap
                return (
                  <tr key={n.id} className="border-b border-white/5 last:border-0">
                    <td className="py-3 pr-4">
                      <div className="text-slate-100">{fmt(n.phone_number)}</div>
                      {n.label && <div className="text-xs text-slate-500">{n.label}</div>}
                    </td>
                    <td className={`py-3 pr-4 ${atCap ? 'text-amber-400' : 'text-slate-300'}`}>
                      {used}{atCap && <span className="text-xs ml-1">at cap</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <input
                        type="number" min={1} max={500} value={n.daily_cap}
                        onChange={e => patch(n.id, { daily_cap: Number(e.target.value) })}
                        className="w-16 bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-orange-500/50"
                      />
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{h?.calls ?? '—'}</td>
                    <td className="py-3 pr-4 text-slate-300">
                      {h ? pct(h.conversations, h.calls) : '—'}
                    </td>
                    <td className={`py-3 pr-4 ${h && h.calls > 0 && h.short_calls / h.calls > 0.35 ? 'text-amber-400' : 'text-slate-300'}`}>
                      {h ? pct(h.short_calls, h.calls) : '—'}
                    </td>
                    <td className={`py-3 pr-4 ${h && h.callbacks > 0 ? 'text-green-400' : 'text-slate-300'}`}>
                      {h?.callbacks ?? '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        onClick={() => patch(n.id, { registered: !n.registered })}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                          n.registered
                            ? 'text-green-400 bg-green-400/10 border-green-400/20'
                            : 'text-amber-400 bg-amber-500/15 border-amber-600/50'
                        }`}
                      >
                        {n.registered ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                        {n.registered ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        onClick={() => patch(n.id, { inbound_mode: n.inbound_mode === 'full' ? 'deflect' : 'full' })}
                        title={
                          n.inbound_mode === 'full'
                            ? 'Callbacks ring the owning agent, then the hunt group, then voicemail.'
                            : 'Callbacks hear a spoken redirect to the main line, then hang up.'
                        }
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                          n.inbound_mode === 'full'
                            ? 'text-green-400 bg-green-400/10 border-green-400/20'
                            : 'text-slate-500 bg-white/5 border-white/10'
                        }`}
                      >
                        {n.inbound_mode === 'full'
                          ? <PhoneIncoming className="w-3 h-3" />
                          : <PhoneForwarded className="w-3 h-3" />}
                        {n.inbound_mode === 'full' ? 'Rings' : 'Redirect'}
                      </button>
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        onClick={() => patch(n.id, { is_active: !n.is_active })}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          n.is_active
                            ? 'text-green-400 bg-green-400/10 border-green-400/20'
                            : 'text-slate-500 bg-white/5 border-white/10'
                        }`}
                      >
                        {n.is_active ? 'Active' : 'Rested'}
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => remove(n)}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                        title="Remove from pool"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-slate-100 text-sm font-medium">Add a number</h3>
            <button onClick={() => { setShowForm(false); setForm({ ...EMPTY }) }} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Number</label>
              <input
                type="tel" value={form.phone_number} placeholder="+1 908 639 5666"
                onChange={e => { setForm(f => ({ ...f, phone_number: e.target.value })); setResult(null) }}
                className="w-44 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Label</label>
              <input
                type="text" value={form.label} placeholder="NJ main"
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                className="w-36 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Daily cap</label>
              <input
                type="number" min={1} max={500} value={form.daily_cap}
                onChange={e => setForm(f => ({ ...f, daily_cap: Number(e.target.value) }))}
                className="w-24 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 py-2">
              <input
                type="checkbox" checked={form.registered}
                onChange={e => setForm(f => ({ ...f, registered: e.target.checked }))}
                className="accent-orange-500"
              />
              Registered
            </label>
            <button
              onClick={add}
              disabled={saving || !form.phone_number.trim()}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowForm(true); setResult(null) }}
          className="flex items-center gap-1.5 text-orange-400 hover:text-orange-300 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add number
        </button>
      )}

      {result && (
        <div className={`mt-4 flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border w-fit ${result.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
          {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {result.msg}
        </div>
      )}
    </div>
  )
}
