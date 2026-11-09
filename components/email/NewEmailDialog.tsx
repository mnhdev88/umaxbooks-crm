'use client'

import { useState } from 'react'
import { X, Loader2, UserPlus, CheckCircle2, ArrowRight, Mail } from 'lucide-react'
import { LEAD_SOURCES, type LeadSource } from '@/types'

export interface RecipientLead {
  id: string
  name: string | null
  company_name: string | null
  email: string | null
  alt_emails: { value: string; label?: string }[] | null
  assignee?: { full_name: string } | null
}

/**
 * Step 1 of "New email": pick the recipient. An address that already belongs to a lead
 * (primary or alternate email) is used as-is; a new address creates a lead first
 * (assigned to the sender, status Contacted) so the email and replies are tracked.
 */
export function NewEmailDialog({
  onClose,
  onReady,
}: {
  onClose: () => void
  /** Recipient resolved — open the compose window for this lead and address. */
  onReady: (lead: RecipientLead, toEmail: string) => void
}) {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'existing' | 'create'>('email')
  const [lead, setLead] = useState<RecipientLead | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ company_name: '', name: '', phone: '', website_url: '', source: 'Other' as LeadSource })

  async function call(payload: Record<string, unknown>) {
    const res = await fetch('/api/email/recipient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || 'Something went wrong')
    return json as { lead: RecipientLead | null }
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { lead } = await call({ action: 'lookup', email })
      if (lead) {
        setLead(lead)
        setStep('existing')
      } else {
        // Sensible defaults from the address: jane@acme-roofing.com → "Jane", "Acme Roofing"
        const [local, domain = ''] = email.trim().toLowerCase().split('@')
        const free = /^(gmail|yahoo|hotmail|outlook|icloud|aol|live|msn|protonmail)\./.test(domain)
        const title = (s: string) => s.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
        setForm(f => ({
          ...f,
          name: f.name || title(local.split(/[+]/)[0]),
          company_name: f.company_name || (free ? '' : title(domain.split('.')[0])),
          website_url: f.website_url || (free ? '' : `https://${domain}`),
        }))
        setStep('create')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { lead } = await call({ action: 'create', email, ...form })
      if (lead) onReady(lead, email.trim())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const F = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-orange-500/50 focus:outline-none'
  const L = 'mb-1 block text-xs text-slate-400'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 pb-6 pt-16 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label="New email" className="w-full max-w-md rounded-2xl border border-white/10 bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Mail className="h-4 w-4 text-orange-400" /> New email
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {step === 'email' && (
            <form onSubmit={lookup} className="space-y-4">
              <div>
                <label className={L} htmlFor="new-email-to">To</label>
                <input
                  id="new-email-to"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="client@company.com"
                  className={F}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  If this address isn&apos;t a lead yet, you&apos;ll add a few details and it&apos;s created as your lead.
                </p>
              </div>
              <SubmitRow busy={busy} label="Continue" />
            </form>
          )}

          {step === 'existing' && lead && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-white">{lead.company_name || lead.name}</p>
                  <p className="text-xs text-slate-400">
                    {email} is already a lead{lead.name && lead.company_name ? ` (${lead.name})` : ''}
                    {lead.assignee?.full_name ? ` · assigned to ${lead.assignee.full_name}` : ''}.
                    The email will be added to their history.
                  </p>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <button onClick={() => { setStep('email'); setLead(null) }} className="text-xs text-slate-400 hover:text-white">
                  Change address
                </button>
                <button
                  onClick={() => onReady(lead, email.trim())}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600"
                >
                  Write email <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {step === 'create' && (
            <form onSubmit={create} className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-slate-300">
                <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
                <span><strong className="text-white">{email}</strong> isn&apos;t in the CRM yet. A new lead will be created, assigned to you as <em>Contacted</em>.</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={L} htmlFor="ne-company">Company *</label>
                  <input id="ne-company" required value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} className={F} />
                </div>
                <div>
                  <label className={L} htmlFor="ne-name">Contact name *</label>
                  <input id="ne-name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={F} />
                </div>
                <div>
                  <label className={L} htmlFor="ne-phone">Phone</label>
                  <input id="ne-phone" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={F} />
                </div>
                <div>
                  <label className={L} htmlFor="ne-source">Source</label>
                  <select id="ne-source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as LeadSource })} className={`${F} bg-surface`}>
                    {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className={L} htmlFor="ne-web">Website</label>
                  <input id="ne-web" value={form.website_url} onChange={e => setForm({ ...form, website_url: e.target.value })} placeholder="https://" className={F} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button type="button" onClick={() => setStep('email')} className="text-xs text-slate-400 hover:text-white">
                  Change address
                </button>
                <SubmitRow busy={busy} label="Create lead & write email" />
              </div>
            </form>
          )}

          {error && <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function SubmitRow({ busy, label }: { busy: boolean; label: string }) {
  return (
    <div className="flex justify-end">
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        {label}
      </button>
    </div>
  )
}
