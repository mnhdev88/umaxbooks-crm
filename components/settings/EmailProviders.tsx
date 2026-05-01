'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Trash2, Star, Wifi, CheckCircle, AlertCircle } from 'lucide-react'

type ProviderType = 'gmail' | 'aws_ses' | 'resend' | 'custom'

interface EmailProvider {
  id: string
  name: string
  provider: ProviderType
  host: string | null
  port: number | null
  secure: boolean
  username: string | null
  password: string | null
  api_key: string | null
  from_email: string
  from_name: string
  is_default: boolean
  is_active: boolean
}

const PROVIDER_PRESETS: Record<ProviderType, { label: string; host: string; port: number; secure: boolean }> = {
  gmail:   { label: 'Gmail',        host: 'smtp.gmail.com',                         port: 587, secure: false },
  aws_ses: { label: 'AWS SES',      host: 'email-smtp.us-east-1.amazonaws.com',     port: 587, secure: false },
  resend:  { label: 'Resend API',   host: '',                                        port: 0,   secure: false },
  custom:  { label: 'Custom SMTP',  host: '',                                        port: 587, secure: false },
}

const PROVIDER_HINTS: Partial<Record<ProviderType, string>> = {
  gmail:   'Requires a 16-digit App Password — not your regular password. Enable 2FA → Google Account → Security → App Passwords.',
  aws_ses: 'Use SMTP credentials from AWS SES console (not IAM access keys). Adjust region in the host if needed.',
  resend:  'Enter your Resend API key (starts with re_). Get one free at resend.com — 3,000 emails/month.',
}

const EMPTY: Omit<EmailProvider, 'id' | 'is_active'> = {
  name: '', provider: 'gmail',
  host: 'smtp.gmail.com', port: 587, secure: false,
  username: '', password: '', api_key: '',
  from_email: '', from_name: 'UMAX CRM',
  is_default: false,
}

export function EmailProviders() {
  const [providers, setProviders]   = useState<EmailProvider[]>([])
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({ ...EMPTY })
  const [saving, setSaving]         = useState(false)
  const [testing, setTesting]       = useState<string | null>(null)
  const [results, setResults]       = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [formTesting, setFormTesting]       = useState(false)
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testTo, setTestTo]                 = useState('')
  const supabase = createClient()

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('email_providers').select('*').order('created_at')
    setProviders(data || [])
  }

  async function testForm() {
    setFormTesting(true)
    setFormTestResult(null)
    const res = await fetch('/api/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, test_to: testTo || undefined }),
    })
    const data = await res.json()
    setFormTestResult({
      ok: res.ok,
      msg: res.ok ? `Test email sent to ${data.sent_to}` : (data.error || 'Failed'),
    })
    setFormTesting(false)
  }

  function setType(type: ProviderType) {
    const p = PROVIDER_PRESETS[type]
    setForm(f => ({ ...f, provider: type, host: p.host, port: p.port, secure: p.secure }))
    setFormTestResult(null)
  }

  function field(key: keyof typeof EMPTY, value: any) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function isValid() {
    if (!form.name || !form.from_email) return false
    if (form.provider === 'resend') return !!form.api_key
    return !!(form.host && form.username && form.password)
  }

  async function save() {
    setSaving(true)
    const payload = form.provider === 'resend'
      ? { ...form, host: null, port: null, secure: false, username: null, password: null }
      : { ...form, api_key: null }

    const { error } = await supabase.from('email_providers').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return }
    load()
    setShowForm(false)
    setForm({ ...EMPTY })
  }

  async function setDefault(id: string) {
    await supabase.from('email_providers').update({ is_default: false }).neq('id', id)
    await supabase.from('email_providers').update({ is_default: true }).eq('id', id)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this email provider?')) return
    await supabase.from('email_providers').delete().eq('id', id)
    load()
  }

  async function test(p: EmailProvider) {
    setTesting(p.id)
    setResults(r => ({ ...r, [p.id]: { ok: false, msg: 'Testing…' } }))
    const res = await fetch('/api/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    })
    const data = await res.json()
    setResults(r => ({ ...r, [p.id]: { ok: res.ok, msg: res.ok ? 'Test email sent!' : (data.error || 'Failed') } }))
    setTesting(null)
  }

  return (
    <div className="bg-[#0d1f3c] border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-white font-semibold text-lg">Email Providers</h2>
          <p className="text-slate-400 text-sm mt-1">Configure SMTP servers for sending emails to clients</p>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setForm({ ...EMPTY }) }}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancel' : 'Add Provider'}
        </button>
      </div>

      {showForm && (
        <div className="bg-[#0a1628] border border-white/10 rounded-xl p-5 mb-6 space-y-4">
          <h3 className="text-white font-medium text-sm">New Email Provider</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Display Name</label>
              <input
                value={form.name}
                onChange={e => field('name', e.target.value)}
                placeholder="e.g. Company Gmail"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">Provider</label>
              <select
                value={form.provider}
                onChange={e => setType(e.target.value as ProviderType)}
                className="w-full bg-[#0a1628] border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
              >
                {(Object.keys(PROVIDER_PRESETS) as ProviderType[]).map(k => (
                  <option key={k} value={k}>{PROVIDER_PRESETS[k].label}</option>
                ))}
              </select>
            </div>
          </div>

          {form.provider !== 'resend' && (
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="text-xs text-slate-400 mb-1.5 block">SMTP Host</label>
                <input
                  value={form.host ?? ''}
                  onChange={e => field('host', e.target.value)}
                  placeholder="smtp.example.com"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">Port</label>
                <input
                  type="number"
                  value={form.port ?? 587}
                  onChange={e => field('port', +e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>
          )}

          {form.provider === 'resend' ? (
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">API Key</label>
              <input
                value={form.api_key ?? ''}
                onChange={e => field('api_key', e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxx"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">
                  {form.provider === 'aws_ses' ? 'SES SMTP Username' : 'Username / Email'}
                </label>
                <input
                  value={form.username ?? ''}
                  onChange={e => field('username', e.target.value)}
                  placeholder={form.provider === 'gmail' ? 'you@gmail.com' : 'SMTP Username'}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block">
                  {form.provider === 'gmail' ? 'App Password (16 digits)' : form.provider === 'aws_ses' ? 'SES SMTP Password' : 'Password'}
                </label>
                <input
                  type="password"
                  value={form.password ?? ''}
                  onChange={e => field('password', e.target.value)}
                  placeholder="••••••••••••••••"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">From Email</label>
              <input
                value={form.from_email}
                onChange={e => field('from_email', e.target.value)}
                placeholder="reports@yourdomain.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1.5 block">From Name</label>
              <input
                value={form.from_name}
                onChange={e => field('from_name', e.target.value)}
                placeholder="UMAX CRM"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Send Test Email To</label>
            <input
              type="email"
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              placeholder="Leave blank to send to your admin account"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
            />
            {form.provider === 'gmail' && (
              <p className="text-xs text-slate-500 mt-1">Gmail will send from {form.username || 'your Gmail address'}, not the From Email below.</p>
            )}
          </div>

          {PROVIDER_HINTS[form.provider] && (
            <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
              {PROVIDER_HINTS[form.provider]}
            </p>
          )}

          {formTestResult && (
            <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${formTestResult.ok ? 'text-green-400 bg-green-400/10 border-green-400/20' : 'text-red-400 bg-red-400/10 border-red-400/20'}`}>
              {formTestResult.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              {formTestResult.msg}
            </div>
          )}

          <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => field('is_default', e.target.checked)}
                className="accent-orange-500 w-4 h-4"
              />
              Set as default provider
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={testForm}
                disabled={formTesting || !isValid()}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 text-slate-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Wifi className="w-4 h-4" />
                {formTesting ? 'Sending…' : 'Test Email'}
              </button>
              <button
                onClick={save}
                disabled={saving || !isValid()}
                className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {saving ? 'Saving…' : 'Save Provider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {providers.length === 0 && !showForm && (
        <div className="text-center py-10 text-slate-400 text-sm">
          No email providers configured. Add one to start sending emails.
        </div>
      )}

      <div className="space-y-2">
        {providers.map(p => {
          const result = results[p.id]
          return (
            <div key={p.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-2 h-2 shrink-0 rounded-full ${p.is_active ? 'bg-green-400' : 'bg-slate-500'}`} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium truncate">{p.name}</span>
                    {p.is_default && (
                      <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                        <Star className="w-3 h-3" /> Default
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 text-xs">
                    {PROVIDER_PRESETS[p.provider].label} · {p.from_email}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 ml-3">
                {result && (
                  <span className={`hidden sm:flex items-center gap-1 text-xs px-2 py-0.5 rounded-full mr-1 ${result.ok ? 'text-green-400 bg-green-400/10' : 'text-red-400 bg-red-400/10'}`}>
                    {result.ok ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {result.msg}
                  </span>
                )}
                <button
                  onClick={() => test(p)}
                  disabled={testing === p.id}
                  title="Send test email"
                  className="flex items-center gap-1 text-slate-400 hover:text-blue-400 px-2 py-1.5 rounded-lg hover:bg-blue-400/10 transition-colors text-xs"
                >
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{testing === p.id ? '…' : 'Test'}</span>
                </button>
                {!p.is_default && (
                  <button
                    onClick={() => setDefault(p.id)}
                    title="Set as default"
                    className="text-slate-400 hover:text-orange-400 p-1.5 rounded-lg hover:bg-orange-400/10 transition-colors"
                  >
                    <Star className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => remove(p.id)}
                  title="Delete provider"
                  className="text-slate-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-400/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
