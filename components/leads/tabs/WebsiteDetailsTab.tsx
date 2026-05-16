'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LiveSite, ClientEmail } from '@/types'
import { Plus, Trash2, Save, ExternalLink } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { SendClientInviteButton } from '@/components/portal/SendClientInviteButton'
import { Lead } from '@/types'

interface Props {
  lead: Lead
  userId: string
  userRole: string
}

const EMPTY_EMAIL = { email_address: '', label: '', provider: '' }

export function WebsiteDetailsTab({ lead, userId, userRole }: Props) {
  const supabase = createClient()
  const canEdit  = userRole === 'admin' || userRole === 'developer'

  const [liveSite, setLiveSite]    = useState<LiveSite | null>(null)
  const [emails, setEmails]        = useState<ClientEmail[]>([])
  const [newEmail, setNewEmail]    = useState(EMPTY_EMAIL)
  const [saving, setSaving]        = useState(false)
  const [saved, setSaved]          = useState(false)
  const [saveError, setSaveError]  = useState<string | null>(null)
  const [addingEmail, setAddingEmail] = useState(false)

  const [form, setForm] = useState({
    domain_registrar:         '',
    domain_expiry:            '',
    hosting_expiry:           '',
    ssl_expiry:               '',
    hosting_cpanel_url:       '',
    maintenance_plan:         false,
    maintenance_renewal_date: '',
    maintenance_monthly_amt:  '',
  })

  useEffect(() => { fetchData() }, [lead.id])

  async function fetchData() {
    // Fetch independently so one failure doesn't block the other
    const { data: site } = await supabase
      .from('live_sites').select('*').eq('lead_id', lead.id).maybeSingle()

    const { data: emailList } = await supabase
      .from('client_emails').select('*').eq('lead_id', lead.id).order('created_at')

    if (site) {
      setLiveSite(site)
      setForm({
        domain_registrar:         site.domain_registrar         ?? '',
        domain_expiry:            site.domain_expiry            ?? '',
        hosting_expiry:           site.hosting_expiry           ?? '',
        ssl_expiry:               site.ssl_expiry               ?? '',
        hosting_cpanel_url:       site.hosting_cpanel_url       ?? '',
        maintenance_plan:         site.maintenance_plan         ?? false,
        maintenance_renewal_date: site.maintenance_renewal_date ?? '',
        maintenance_monthly_amt:  site.maintenance_monthly_amt  ? String(site.maintenance_monthly_amt) : '',
      })
    }
    setEmails((emailList ?? []) as ClientEmail[])
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const payload = {
      lead_id:                  lead.id,
      domain_registrar:         form.domain_registrar         || null,
      domain_expiry:            form.domain_expiry            || null,
      hosting_expiry:           form.hosting_expiry           || null,
      ssl_expiry:               form.ssl_expiry               || null,
      hosting_cpanel_url:       form.hosting_cpanel_url       || null,
      maintenance_plan:         form.maintenance_plan,
      maintenance_renewal_date: form.maintenance_renewal_date || null,
      maintenance_monthly_amt:  form.maintenance_monthly_amt  ? parseFloat(form.maintenance_monthly_amt) : null,
    }

    // Always upsert — handles both "no row yet" and "row exists from LiveTab"
    const { error } = await supabase
      .from('live_sites')
      .upsert(payload, { onConflict: 'lead_id' })

    setSaving(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    await supabase.from('activity_logs').insert({
      lead_id: lead.id,
      user_id: userId,
      action:  'Website Details Updated',
      details: `Domain expiry: ${form.domain_expiry || 'not set'}, Hosting expiry: ${form.hosting_expiry || 'not set'}`,
    })

    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchData()
  }

  async function addEmail() {
    if (!newEmail.email_address.trim()) return
    setAddingEmail(true)
    const { data } = await supabase
      .from('client_emails')
      .insert({
        lead_id:       lead.id,
        email_address: newEmail.email_address.trim(),
        label:         newEmail.label.trim()    || null,
        provider:      newEmail.provider.trim() || null,
      })
      .select().single()
    setAddingEmail(false)
    if (data) {
      setEmails(prev => [...prev, data as ClientEmail])
      setNewEmail(EMPTY_EMAIL)
    }
  }

  async function removeEmail(id: string) {
    await supabase.from('client_emails').delete().eq('id', id)
    setEmails(prev => prev.filter(e => e.id !== id))
  }

  const field = (
    key: keyof typeof form,
    label: string,
    type: string = 'text',
    placeholder?: string,
  ) => (
    <Input
      label={label}
      type={type}
      placeholder={placeholder}
      value={String(form[key])}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      disabled={!canEdit}
    />
  )

  return (
    <div className="space-y-8">

      {/* ── Client Portal Invite ─────────────────────── */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
          Client Portal
        </p>
        <p className="text-xs text-slate-400 mb-4">
          Send the client a magic link to access their project portal at{' '}
          <span className="text-slate-300">/portal</span>. Only available once the lead is
          marked as <span className="text-orange-400">Live</span> or{' '}
          <span className="text-orange-400">Completed</span>.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <SendClientInviteButton lead={lead} />
          <a
            href={`/api/portal-preview?lead_id=${lead.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm
                       bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
          >
            <ExternalLink size={13} />
            Preview Portal
          </a>
        </div>
      </div>

      {/* ── Domain & Hosting ─────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
          Domain &amp; Hosting
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field('domain_registrar',   'Domain Registrar', 'text',   'e.g. GoDaddy, Namecheap')}
          {field('domain_expiry',      'Domain Expiry Date', 'date')}
          {field('hosting_expiry',     'Hosting Expiry Date', 'date')}
          {field('ssl_expiry',         'SSL Certificate Expiry', 'date')}
          <div className="md:col-span-2">
            {field('hosting_cpanel_url', 'cPanel / Hosting Login URL (staff only)', 'url', 'https://')}
            {form.hosting_cpanel_url && (
              <a
                href={form.hosting_cpanel_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1"
              >
                Open cPanel <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Maintenance Plan ─────────────────────────── */}
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
          Maintenance Plan
        </p>
        <div className="flex items-center gap-3 mb-4">
          <input
            type="checkbox"
            id="maintenance_plan"
            checked={form.maintenance_plan}
            onChange={e => setForm(f => ({ ...f, maintenance_plan: e.target.checked }))}
            disabled={!canEdit}
            className="w-4 h-4 accent-orange-500 cursor-pointer"
          />
          <label htmlFor="maintenance_plan" className="text-sm text-slate-300 cursor-pointer">
            Client is on a monthly maintenance plan
          </label>
        </div>
        {form.maintenance_plan && (
          <div className="grid grid-cols-2 gap-4">
            {field('maintenance_renewal_date', 'Next Renewal Date', 'date')}
            {field('maintenance_monthly_amt',  'Monthly Amount ($)', 'number')}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} loading={saving}>
              <Save size={14} />
              {saved ? 'Saved!' : 'Save Details'}
            </Button>
            {saved && <span className="text-green-400 text-sm">Changes saved successfully</span>}
          </div>
          {saveError && (
            <p className="text-red-400 text-xs">Save failed: {saveError}</p>
          )}
        </div>
      )}

      {/* ── Client Email Accounts ───────────────────── */}
      <div className="border-t border-slate-800 pt-6">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">
          Client Email Accounts
        </p>

        {emails.length > 0 && (
          <div className="space-y-2 mb-4">
            {emails.map(e => (
              <div
                key={e.id}
                className="flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-4 text-sm min-w-0">
                  <span className="text-white font-medium truncate">{e.email_address}</span>
                  {e.label    && <span className="text-slate-400 shrink-0">{e.label}</span>}
                  {e.provider && <span className="text-slate-500 text-xs shrink-0">{e.provider}</span>}
                </div>
                {canEdit && (
                  <button
                    onClick={() => removeEmail(e.id)}
                    className="text-slate-600 hover:text-red-400 transition-colors p-1 ml-2 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="grid grid-cols-3 gap-3 items-end">
            <Input
              label="Email Address"
              type="email"
              placeholder="info@client.com"
              value={newEmail.email_address}
              onChange={e => setNewEmail(p => ({ ...p, email_address: e.target.value }))}
            />
            <Input
              label="Label"
              placeholder="Info, Support, Sales..."
              value={newEmail.label}
              onChange={e => setNewEmail(p => ({ ...p, label: e.target.value }))}
            />
            <div className="flex gap-2 items-end">
              <Input
                label="Provider"
                placeholder="Google, cPanel..."
                value={newEmail.provider}
                onChange={e => setNewEmail(p => ({ ...p, provider: e.target.value }))}
              />
              <Button
                onClick={addEmail}
                loading={addingEmail}
                disabled={!newEmail.email_address.trim()}
                className="shrink-0 mb-0.5"
              >
                <Plus size={14} />
              </Button>
            </div>
          </div>
        )}

        {emails.length === 0 && !canEdit && (
          <p className="text-sm text-slate-500">No email accounts added yet.</p>
        )}
      </div>
    </div>
  )
}
