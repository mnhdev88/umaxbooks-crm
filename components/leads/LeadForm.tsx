'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { slugify, cn } from '@/lib/utils'
import { assignableAgents } from '@/lib/leads/assignable'
import { Lead, LeadAltContact, LeadSource, Profile, PIPELINE_STAGES } from '@/types'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2, CheckCircle2, Sparkles, ExternalLink, ShieldCheck, ShieldAlert, ShieldX, Plus, X } from 'lucide-react'

const SOURCES = [
  { id: 'GMB',          label: 'GMB',          icon: '📍' },
  { id: 'Facebook',     label: 'Facebook / IG', icon: '📘' },
  { id: 'LinkedIn',     label: 'LinkedIn',      icon: '💼' },
  { id: 'WhatsApp',     label: 'WhatsApp',      icon: '💬' },
  { id: 'Referral',     label: 'Referral',      icon: '🤝' },
  { id: 'Cold Call',    label: 'Cold Call',     icon: '📞' },
  { id: 'Website Form', label: 'Website Form',  icon: '🌐' },
  { id: 'Other',        label: 'Other',         icon: '⊕' },
]

const WEBSITE_STATUSES = [
  'Active / Live',
  'Outdated / Needs redesign',
  'No website',
  'Under construction',
]

const PRIORITIES = ['Normal', 'High', 'Urgent', 'Low']

// Label options for additional emails / phone numbers ("+ Add another …" rows).
const ALT_LABELS = ['Work', 'Personal', 'Office', 'Other']

const schema = z.object({
  name:                  z.string().min(1, 'Required'),
  company_name:          z.string().min(1, 'Required'),
  business_type:         z.string().optional(),
  phone:                 z.string().optional(),
  email:                 z.string().email('Invalid email').optional().or(z.literal('')),
  address:               z.string().optional(),
  city:                  z.string().optional(),
  zip_code:              z.string().optional(),
  country:               z.string().optional(),
  website_url:           z.string().optional(),
  website_status:        z.string().optional(),
  social_url:            z.string().optional(),
  whatsapp_number:       z.string().optional(),
  gmb_url:               z.string().optional(),
  gmb_review_rating:     z.string().optional(),
  number_of_reviews:     z.string().optional(),
  gmb_category:          z.string().optional(),
  gmb_last_seen:         z.string().optional(),
  competitor_count:      z.string().optional(),
  competitor_notes:      z.string().optional(),
  status:                z.string(),
  assigned_agent_id:     z.string().optional(),
  priority:              z.string().optional(),
  notes:                 z.string().optional(),
  custom_field_1_label:  z.string().optional(),
  custom_field_1_value:  z.string().optional(),
  custom_field_2_label:  z.string().optional(),
  custom_field_2_value:  z.string().optional(),
  agent_private_notes:   z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface LeadFormProps {
  lead?: Lead
  agents: Profile[]
  onSuccess?: () => void
  userId: string
  /** Current user's role — scopes the "Assign to Agent" options (managers see their team). */
  userRole?: string
  existingLeads?: Lead[]
}

export function LeadForm({ lead, agents, onSuccess, userId, userRole, existingLeads = [] }: LeadFormProps) {
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [dupLead, setDupLead]           = useState<{ id: string; company_name: string; field: string } | null>(null)
  const [source, setSource]             = useState<LeadSource>(lead?.source || 'GMB')
  const [stars, setStars]               = useState(() => {
    const n = lead?.gmb_review_rating || 0
    return '★'.repeat(Math.min(Math.floor(n), 5)) + '☆'.repeat(Math.max(0, 5 - Math.floor(n)))
  })
  const [extracting, setExtracting]         = useState(false)
  const [extractSuccess, setExtractSuccess] = useState(false)
  const [extractError, setExtractError]     = useState<string | null>(null)
  const extractTimerRef                     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedGmbUrl                         = useRef(lead?.gmb_url || '')
  // Additional emails / phones — leads.alt_emails / alt_phones jsonb arrays.
  // The main email/phone inputs stay the primary; these are the extra rows.
  const [altEmails, setAltEmails] = useState<LeadAltContact[]>(lead?.alt_emails || [])
  const [altPhones, setAltPhones] = useState<LeadAltContact[]>(lead?.alt_phones || [])
  const [findingEmail, setFindingEmail]     = useState(false)
  const [emailFindMsg, setEmailFindMsg]     = useState<string | null>(null)
  const [validatingEmail, setValidatingEmail] = useState(false)
  const [emailValidation, setEmailValidation] = useState<{
    verdict: string; score: number; suggestion: string | null;
    checks: { isDisposable: boolean; isRoleAddress: boolean; hasKnownBounces: boolean; hasMxRecord: boolean }
  } | null>(null)
  const lastValidatedRef = useRef<string>('')
  const router = useRouter()
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                 lead?.name || '',
      company_name:         lead?.company_name || '',
      business_type:        lead?.business_type || '',
      phone:                lead?.phone || '',
      email:                lead?.email || '',
      address:              lead?.address || '',
      city:                 lead?.city || '',
      zip_code:             lead?.zip_code || '',
      country:              lead?.country || 'USA',
      website_url:          lead?.website_url || '',
      website_status:       lead?.website_status || '',
      social_url:           lead?.social_url || '',
      whatsapp_number:      lead?.whatsapp_number || '',
      gmb_url:              lead?.gmb_url || '',
      gmb_review_rating:    lead?.gmb_review_rating?.toString() || '',
      number_of_reviews:    lead?.number_of_reviews?.toString() || '',
      gmb_category:         lead?.gmb_category || '',
      gmb_last_seen:        lead?.gmb_last_seen || '',
      competitor_count:     lead?.competitor_count?.toString() || '',
      competitor_notes:     lead?.competitor_notes || '',
      status:               lead?.status || 'New',
      assigned_agent_id:    lead?.assigned_agent_id || '',
      priority:             lead?.priority || 'Normal',
      notes:                lead?.notes || '',
      custom_field_1_label: lead?.custom_field_1_label || '',
      custom_field_1_value: lead?.custom_field_1_value || '',
      custom_field_2_label: lead?.custom_field_2_label || '',
      custom_field_2_value: lead?.custom_field_2_value || '',
      agent_private_notes:  lead?.agent_private_notes || '',
    },
  })

  const watchedGmbUrl     = watch('gmb_url')
  const watchedWebsiteUrl = watch('website_url')
  const watchedCompany    = watch('company_name')
  const watchedCity       = watch('city')

  function updateStars(val: string) {
    const n = parseFloat(val)
    if (isNaN(n)) return
    setStars('★'.repeat(Math.min(Math.floor(n), 5)) + '☆'.repeat(Math.max(0, 5 - Math.floor(n))))
  }

  function isGmbUrl(url: string) {
    return /maps\.google\.com|google\.com\/maps|goo\.gl\/maps|maps\.app\.goo\.gl|g\.page|g\.co/.test(url)
  }

  async function extractGmbData(url: string) {
    setExtracting(true)
    setExtractError(null)
    setExtractSuccess(false)
    try {
      const res = await fetch('/api/extract-gmb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gmbUrl: url }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setExtractError(data.error || 'Could not extract GMB data')
        return
      }
      // Populate form fields — only overwrite if the field is currently empty
      const COUNTRY_MAP: Record<string, string> = {
        'united states':          'USA',
        'united states of america':'USA',
        'united arab emirates':   'UAE',
        'united kingdom':         'UK',
        'great britain':          'UK',
        'england':                'UK',
        'india':                  'India',
      }
      const normalizeCountry = (c: string) =>
        COUNTRY_MAP[c.toLowerCase()] ?? (
          ['India','USA','UAE','UK'].includes(c) ? c : 'Other'
        )

      const fields: Array<[keyof FormData, string]> = [
        ['company_name',      data.name],
        ['phone',             data.phone],
        ['address',           data.address],
        ['city',              data.city],
        ['zip_code',          data.zip_code],
        ['country',           data.country ? normalizeCountry(data.country) : ''],
        ['website_url',       data.website_url],
        ['gmb_review_rating', data.gmb_review_rating?.toString()],
        ['number_of_reviews', data.number_of_reviews?.toString()],
        ['gmb_category',      data.gmb_category],
        ['gmb_last_seen',     data.gmb_last_seen],
        ['social_url',        data.social_url],
      ]
      for (const [field, value] of fields) {
        if (value) setValue(field, value, { shouldDirty: true })
      }
      if (data.gmb_review_rating) updateStars(data.gmb_review_rating.toString())
      setExtractSuccess(true)
    } catch (e: any) {
      setExtractError('Network error — please try again')
    } finally {
      setExtracting(false)
    }
  }

  async function findEmail() {
    const websiteUrl  = watchedWebsiteUrl?.trim() || undefined
    const companyName = watchedCompany?.trim()    || undefined
    if (!websiteUrl && !companyName) return

    setFindingEmail(true)
    setEmailFindMsg(null)
    try {
      const res  = await fetch('/api/extract-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl, companyName, city: watchedCity?.trim() || '' }),
      })
      const data = await res.json()
      if (data.email) {
        setValue('email', data.email, { shouldDirty: true })
        setEmailFindMsg(`✓ Found via ${data.source === 'website' ? 'website' : 'web search'}`)
        runEmailValidation(false, data.email)   // auto-check the address we just found
      } else if (data.googleSearchUrl) {
        // Nothing found automatically — open Google search as final fallback
        window.open(data.googleSearchUrl, '_blank', 'noopener')
        setEmailFindMsg('Opened Google search — paste the email here once found')
      } else {
        setEmailFindMsg('No email found')
      }
    } catch {
      setEmailFindMsg('Could not complete search')
    } finally {
      setFindingEmail(false)
    }
  }

  // Auto-validates the email. `manual` forces a re-check (bypasses dedupe);
  // `explicitEmail` lets callers pass a value before RHF state settles (e.g. Find Email).
  async function runEmailValidation(manual = false, explicitEmail?: string) {
    const email = (explicitEmail ?? watch('email'))?.trim()
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const emptyChecks = { isDisposable: false, isRoleAddress: false, hasKnownBounces: false, hasMxRecord: false }

    if (!email) { setEmailValidation(null); lastValidatedRef.current = ''; return }

    // Local format gate — instant red, no billable API call on malformed input
    if (!EMAIL_RE.test(email)) {
      lastValidatedRef.current = ''
      setEmailValidation({ verdict: 'Invalid', score: 0, suggestion: null, checks: emptyChecks })
      return
    }

    // Skip duplicate billable calls for an address we already checked
    if (!manual && email === lastValidatedRef.current) return

    setValidatingEmail(true)
    setEmailValidation(null)
    try {
      const res  = await fetch('/api/email/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEmailValidation({ verdict: 'Error', score: 0, suggestion: data.error || 'Validation failed', checks: emptyChecks })
      } else {
        setEmailValidation(data)
        lastValidatedRef.current = email
      }
    } catch {
      setEmailValidation({ verdict: 'Error', score: 0, suggestion: 'Could not reach validation service', checks: emptyChecks })
    } finally {
      setValidatingEmail(false)
    }
  }

  // Watch GMB URL and auto-extract after 600 ms debounce
  // Skip if the URL hasn't changed from the saved value — prevents API call on edit open
  useEffect(() => {
    if (!watchedGmbUrl || !isGmbUrl(watchedGmbUrl)) return
    if (watchedGmbUrl === savedGmbUrl.current) return
    if (extractTimerRef.current) clearTimeout(extractTimerRef.current)
    setExtractSuccess(false)
    setExtractError(null)
    extractTimerRef.current = setTimeout(() => extractGmbData(watchedGmbUrl), 600)
    return () => {
      if (extractTimerRef.current) clearTimeout(extractTimerRef.current)
    }
  }, [watchedGmbUrl])

  async function onSubmit(data: FormData) {
    setLoading(true)
    setError(null)
    setDupLead(null)

    // Every phone/email on this lead — primary first, then the extra rows.
    const cleanAlts = (items: LeadAltContact[]) =>
      items.map(it => ({ label: it.label || 'Other', value: it.value.trim() })).filter(it => it.value)
    const altEmailsClean = cleanAlts(altEmails)
    const altPhonesClean = cleanAlts(altPhones)

    // The zod schema only validates the primary email — check the extra rows here.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const badAlt = altEmailsClean.find(e => !EMAIL_RE.test(e.value))
    if (badAlt) {
      setError(`Invalid additional email: ${badAlt.value}`)
      setLoading(false)
      return
    }

    const allPhones = [data.phone?.trim(), ...altPhonesClean.map(p => p.value)].filter(Boolean) as string[]
    const allEmails = [data.email?.trim(), ...altEmailsClean.map(e => e.value)].filter(Boolean) as string[]

    // Duplicate check — only on new leads. Matches any of this lead's numbers or
    // emails against existing leads' primary columns AND their alt_* arrays.
    if (!lead) {
      const orFilters: string[] = []
      // Double-quote in-list values so phones like "(555) 123-4567" don't break the filter.
      const quote = (v: string) => `"${v.replace(/"/g, '')}"`
      if (allPhones.length) orFilters.push(`phone.in.(${allPhones.map(quote).join(',')})`)
      if (allEmails.length) orFilters.push(`email.in.(${allEmails.map(quote).join(',')})`)
      if (data.company_name?.trim()) orFilters.push(`company_name.ilike.${data.company_name.trim()}`)

      let existing: { id: string; company_name: string; phone?: string | null; email?: string | null } | null = null
      if (orFilters.length > 0) {
        const { data: match } = await supabase
          .from('leads')
          .select('id, company_name, phone, email')
          .or(orFilters.join(','))
          .limit(1)
          .maybeSingle()
        existing = match
      }
      // jsonb containment can't ride inside .or(), so probe the alt arrays per value.
      if (!existing) {
        for (const p of allPhones) {
          const { data: match } = await supabase
            .from('leads')
            .select('id, company_name')
            .contains('alt_phones', JSON.stringify([{ value: p }]))
            .limit(1)
            .maybeSingle()
          if (match) { existing = { ...match, phone: p }; break }
        }
      }
      if (!existing) {
        for (const e of allEmails) {
          const { data: match } = await supabase
            .from('leads')
            .select('id, company_name')
            .contains('alt_emails', JSON.stringify([{ value: e }]))
            .limit(1)
            .maybeSingle()
          if (match) { existing = { ...match, email: e }; break }
        }
      }

      if (existing) {
        const matchedField =
          existing.phone && allPhones.includes(existing.phone) ? 'phone number' :
          existing.email && allEmails.includes(existing.email) ? 'email address' :
          'company name'
        setDupLead({ id: existing.id, company_name: existing.company_name, field: matchedField })
        setLoading(false)
        return
      }
    }
    const payload = {
      ...data,
      source,
      alt_emails: altEmailsClean,
      alt_phones: altPhonesClean,
      gmb_review_rating:  data.gmb_review_rating  ? parseFloat(data.gmb_review_rating)  : null,
      number_of_reviews:  data.number_of_reviews  ? parseInt(data.number_of_reviews)    : null,
      competitor_count:   data.competitor_count   ? parseInt(data.competitor_count)     : null,
      assigned_agent_id:  data.assigned_agent_id  || null,
      slug: lead?.slug || slugify(data.company_name) + '-' + Date.now(),
      ...(!lead && { created_by: userId }),
      // Persist the email-validation verdict so the detail page / list can show it.
      // Clear it when the email is removed; only write a verdict when one exists this session.
      ...(data.email?.trim()
        ? (emailValidation && emailValidation.verdict !== 'Error'
            ? { email_verdict: emailValidation.verdict, email_score: emailValidation.score ?? null, email_validated_at: new Date().toISOString() }
            : {})
        : { email_verdict: null, email_score: null, email_validated_at: null }),
    }
    try {
      if (lead) {
        const { error: err } = await supabase.from('leads').update(payload).eq('id', lead.id)
        if (err) throw err
        await supabase.from('activity_logs').insert({
          lead_id: lead.id, user_id: userId,
          action: 'Lead Updated', details: 'Lead information updated',
        })
      } else {
        const { data: newLead, error: err } = await supabase.from('leads').insert(payload).select().single()
        if (err) throw err
        await supabase.from('activity_logs').insert({
          lead_id: newLead.id, user_id: userId,
          action: 'Lead Created', details: `Lead created for ${payload.company_name}`,
        })
        if (!onSuccess) router.push(`/leads/${newLead.id}`)
      }
      onSuccess?.()
      router.refresh()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const emailReg = register('email')
  const F = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus:border-orange-500 transition-colors'
  const L = 'text-xs font-medium text-slate-400 mb-1 block'
  const S = 'text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 after:flex-1 after:h-px after:bg-slate-800 mt-5 mb-3'

  // Extra email/phone rows below the primary field: [label ▾][value][×] + "Add another".
  function renderAltRows(kind: 'email' | 'phone') {
    const items    = kind === 'email' ? altEmails : altPhones
    const setItems = kind === 'email' ? setAltEmails : setAltPhones
    return (
      <div className="mt-2 space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={item.label || 'Other'}
              onChange={e => setItems(items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)))}
              aria-label={`Additional ${kind} label`}
              className={cn(F, 'w-28 shrink-0 cursor-pointer')}
            >
              {ALT_LABELS.map(l => <option key={l}>{l}</option>)}
            </select>
            <input
              type={kind === 'email' ? 'email' : 'tel'}
              value={item.value}
              onChange={e => setItems(items.map((it, j) => (j === i ? { ...it, value: e.target.value } : it)))}
              placeholder={kind === 'email' ? 'second@company.com' : '+1 555 000 0001'}
              aria-label={`Additional ${kind}`}
              className={cn(F, 'flex-1 min-w-0')}
            />
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              aria-label={`Remove additional ${kind}`}
              className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems([...items, { value: '', label: 'Work' }])}
          className="inline-flex items-center gap-1 text-xs font-medium text-orange-400 hover:text-orange-300 transition-colors"
        >
          <Plus size={12} /> Add another {kind === 'email' ? 'email' : 'phone'}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-700 px-3 py-2.5 text-sm text-red-300 mb-4">
          {error}
        </div>
      )}

      {/* ── Lead Source ─────────────────────────────────────── */}
      <p className={S}>Lead Source</p>
      <div className="grid grid-cols-4 gap-2 mb-1">
        {SOURCES.map(s => (
          <button key={s.id} type="button" onClick={() => setSource(s.id as LeadSource)}
            className={cn(
              'flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border text-xs font-medium transition-all',
              source === s.id
                ? 'border-orange-500 text-orange-400 bg-orange-900/20'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
            )}>
            <span className="text-lg leading-none">{s.icon}</span>
            <span className="text-center leading-tight">{s.label}</span>
          </button>
        ))}
      </div>

      {/* ── GMB Section ─────────────────────────────────────── */}
      {source === 'GMB' && (
        <div className="rounded-xl bg-green-900/10 border border-green-800/30 p-4 mt-4">
          <span className="inline-flex items-center text-xs font-semibold text-green-400 bg-green-900/30 px-2.5 py-0.5 rounded-full mb-3">
            Google My Business
          </span>
          <div className="space-y-3">
            <div>
              <label className={L}>GMB Profile URL</label>
              <div className="relative">
                <input
                  {...register('gmb_url')}
                  className={cn(F, 'pr-8',
                    extracting && 'border-amber-500/60',
                    extractSuccess && 'border-green-600/60',
                    extractError && 'border-red-600/40',
                  )}
                  placeholder="https://maps.google.com/maps?cid=... or paste any Google Maps URL"
                />
                {extracting && (
                  <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-amber-400 animate-spin" />
                )}
                {extractSuccess && !extracting && (
                  <CheckCircle2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-green-400" />
                )}
              </div>
              {extracting && (
                <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1.5">
                  <Sparkles size={11} /> Extracting GMB data — filling form fields...
                </p>
              )}
              {extractSuccess && !extracting && (
                <p className="text-xs text-green-400 mt-1.5 flex items-center gap-1.5">
                  <CheckCircle2 size={11} /> GMB data extracted — review fields below and adjust if needed.
                </p>
              )}
              {extractError && !extracting && (
                <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1.5">
                  <AlertCircle size={11} /> {extractError}
                </p>
              )}
              {!extracting && !extractSuccess && !extractError && (
                <p className="text-xs text-slate-600 mt-1">Paste any Google Maps URL — fields will auto-fill</p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={L}>GMB Rating</label>
                <div className="relative">
                  <input {...register('gmb_review_rating')} type="number" min="1" max="5" step="0.1"
                    className={cn(F, 'pr-16')}
                    placeholder="4.5" onChange={e => updateStars(e.target.value)} />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-yellow-400 text-xs tracking-tight pointer-events-none">{stars}</span>
                </div>
              </div>
              <div>
                <label className={L}>No. of Reviews</label>
                <input {...register('number_of_reviews')} type="number" className={F} placeholder="118" />
              </div>
              <div>
                <label className={L}>GMB Category</label>
                <input {...register('gmb_category')} className={F} placeholder="Dental Clinic" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={L}>Last Seen on GMB</label>
                <input {...register('gmb_last_seen')} type="date" className={cn(F, '[color-scheme:dark]')} />
              </div>
              <div>
                <label className={L}>Competitor Count</label>
                <input {...register('competitor_count')} type="number" min="0" className={F} placeholder="6" />
              </div>
              <div>
                <label className={L}>Competitor Notes</label>
                <input {...register('competitor_notes')} className={F} placeholder="3 with better ratings" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Duplicate blocked ───────────────────────────────── */}
      {dupLead && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-3 text-xs text-red-300 mt-3">
          <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
          <span>
            Duplicate detected — a lead with this <strong>{dupLead.field}</strong> already exists:{' '}
            <a
              href={`/leads/${dupLead.id}`}
              target="_blank"
              rel="noreferrer"
              className="underline font-semibold text-red-200 hover:text-white inline-flex items-center gap-1"
            >
              {dupLead.company_name} <ExternalLink size={10} />
            </a>
            . Save blocked to prevent duplicate.
          </span>
        </div>
      )}

      {/* ── Contact Information ─────────────────────────────── */}
      <p className={S}>Contact Information</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={L}>Contact Name <span className="text-orange-500">*</span></label>
          <input {...register('name')} className={cn(F, errors.name && 'border-red-600')} placeholder="John Smith" />
          {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className={L}>Company / Business Name <span className="text-orange-500">*</span></label>
          <input {...register('company_name')} className={cn(F, errors.company_name && 'border-red-600')} placeholder="Acme Dental Clinic" />
          {errors.company_name && <p className="text-xs text-red-400 mt-1">{errors.company_name.message}</p>}
        </div>
        <div>
          <label className={L}>Business Type</label>
          <input {...register('business_type')} className={F} placeholder="e.g. Dental Clinic, Restaurant, Gym…" />
        </div>
        <div>
          <label className={L}>Phone Number</label>
          <input {...register('phone')} type="tel" className={F} placeholder="+1 555 000 0000" />
          {renderAltRows('phone')}
        </div>
        <div>
          <label className={L}>Email ID</label>
          <div className="flex gap-2">
            <input
              {...emailReg}
              type="email"
              className={cn(
                F, 'flex-1',
                errors.email && 'border-red-600',
                emailValidation?.verdict === 'Valid' && 'border-emerald-500',
                emailValidation?.verdict === 'Risky' && 'border-amber-500',
                (emailValidation?.verdict === 'Invalid' || emailValidation?.verdict === 'Error') && 'border-red-500',
              )}
              placeholder="name@company.com"
              onChange={(e) => { emailReg.onChange(e); setEmailValidation(null) }}
              onBlur={(e) => { emailReg.onBlur(e); runEmailValidation() }}
            />
            <button
              type="button"
              onClick={findEmail}
              disabled={findingEmail || (!watchedWebsiteUrl && !watchedCompany)}
              title={
                watchedWebsiteUrl ? 'Scrape email from website' :
                watchedCompany    ? 'Search web for email' :
                'Add a company name or website URL first'
              }
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-violet-400 hover:text-violet-300 bg-violet-900/20 hover:bg-violet-900/30 border border-violet-800/40 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              {findingEmail ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {findingEmail ? 'Finding…' : 'Find Email'}
            </button>
            <button
              type="button"
              onClick={() => runEmailValidation(true)}
              disabled={validatingEmail || !watch('email')?.trim()}
              title="Re-check email deliverability via SendGrid"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-sky-400 hover:text-sky-300 bg-sky-900/20 hover:bg-sky-900/30 border border-sky-800/40 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              {validatingEmail ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
              {validatingEmail ? 'Checking…' : 'Re-check'}
            </button>
          </div>

          {/* Auto-validation in progress */}
          {validatingEmail && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-500">
              <Loader2 size={11} className="animate-spin" /> Checking email…
            </p>
          )}

          {/* Validation verdict badge */}
          {emailValidation && (
            <div className="mt-1.5 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                {emailValidation.verdict === 'Valid' && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-900/30 border border-emerald-800/40 px-2 py-0.5 rounded-full">
                    <ShieldCheck size={11} /> Valid — safe to send
                  </span>
                )}
                {emailValidation.verdict === 'Risky' && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-900/30 border border-amber-800/40 px-2 py-0.5 rounded-full">
                    <ShieldAlert size={11} /> Risky — may not deliver
                  </span>
                )}
                {(emailValidation.verdict === 'Invalid' || emailValidation.verdict === 'Error') && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 bg-red-900/30 border border-red-800/40 px-2 py-0.5 rounded-full">
                    <ShieldX size={11} /> {emailValidation.verdict === 'Error' ? 'Error' : 'Invalid — do not send'}
                  </span>
                )}
                {emailValidation.score > 0 && (
                  <span className="text-xs text-slate-500">Score: {Math.round(emailValidation.score * 100)}%</span>
                )}
                {emailValidation.checks?.isDisposable  && <span className="text-xs text-amber-500">Disposable address</span>}
                {emailValidation.checks?.hasKnownBounces && <span className="text-xs text-red-500">Known bounces</span>}
                {emailValidation.checks?.isRoleAddress  && <span className="text-xs text-slate-400">Role address (e.g. info@)</span>}
                {!emailValidation.checks?.hasMxRecord   && emailValidation.verdict !== 'Error' && (
                  <span className="text-xs text-red-500">No MX record</span>
                )}
              </div>
              {emailValidation.verdict === 'Error' && emailValidation.suggestion && (
                <p className="text-xs text-slate-500">{emailValidation.suggestion}</p>
              )}
              {emailValidation.verdict !== 'Error' && emailValidation.suggestion && (
                <p className="text-xs text-sky-400">
                  💡 Did you mean <button type="button" onClick={() => { setValue('email', emailValidation.suggestion!); setEmailValidation(null) }} className="underline hover:text-sky-300">{emailValidation.suggestion}</button>?
                </p>
              )}
            </div>
          )}

          {emailFindMsg && (
            <p className={`text-xs mt-1 ${emailFindMsg.startsWith('✓') ? 'text-emerald-400' : 'text-slate-500'}`}>
              {emailFindMsg}
            </p>
          )}
          {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
          {renderAltRows('email')}
        </div>
      </div>

      {/* ── Location ────────────────────────────────────────── */}
      <p className={S}>Location</p>
      <div className="space-y-3">
        <div>
          <label className={L}>Address</label>
          <input {...register('address')} className={F} placeholder="123 Main Street, Suite 100" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={L}>City</label>
            <input {...register('city')} className={F} placeholder="New York" />
          </div>
          <div>
            <label className={L}>ZIP / Postal Code</label>
            <input {...register('zip_code')} className={F} placeholder="10001" />
          </div>
          <div>
            <label className={L}>Country</label>
            <select {...register('country')} className={cn(F, 'cursor-pointer')}>
              <option>USA</option>
              <option>Canada</option>
              <option>UK</option>
              <option>UAE</option>
              <option>India</option>
              <option>Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Online Presence ─────────────────────────────────── */}
      <p className={S}>Online Presence</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={L}>Website URL</label>
          <input {...register('website_url')} type="url" className={F} placeholder="https://example.com" />
        </div>
        <div>
          <label className={L}>Website Status</label>
          <select {...register('website_status')} className={cn(F, 'cursor-pointer')}>
            <option value="">— Select —</option>
            {WEBSITE_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={L}>Social Profile URL</label>
          <input {...register('social_url')} type="url" className={F} placeholder="Facebook / LinkedIn page URL" />
        </div>
        <div>
          <label className={L}>WhatsApp Number</label>
          <input {...register('whatsapp_number')} type="tel" className={F} placeholder="+1 555 000 0000" />
        </div>
      </div>

      {/* ── Assignment & Priority ───────────────────────────── */}
      <p className={S}>Assignment & Priority</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={L}>Assign to Agent</label>
          <select {...register('assigned_agent_id')} className={cn(F, 'cursor-pointer')}>
            <option value="">— Unassigned —</option>
            {assignableAgents(agents, userRole, userId)
              .map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className={L}>Priority</label>
          <select {...register('priority')} className={cn(F, 'cursor-pointer')}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className={L}>Pipeline Status</label>
          <select {...register('status')} className={cn(F, 'cursor-pointer')}>
            {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
            <option>Lost</option>
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label className={L}>Notes / Observations</label>
        <textarea {...register('notes')} rows={3} className={F}
          placeholder="Initial observations about the business, website quality, GMB completeness, competitor presence..." />
      </div>

      {/* ── Custom / Manual Fields ──────────────────────────── */}
      <p className={S}>Custom Fields</p>
      <div className="rounded-xl bg-blue-900/10 border border-blue-800/30 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={L}>Label 1</label>
            <input {...register('custom_field_1_label')} className={F} placeholder="e.g. Referred by, Event name..." />
          </div>
          <div>
            <label className={L}>Value 1</label>
            <input {...register('custom_field_1_value')} className={F} placeholder="e.g. Referrer name, Networking event..." />
          </div>
          <div>
            <label className={L}>Label 2</label>
            <input {...register('custom_field_2_label')} className={F} placeholder="e.g. Budget range, Timeline..." />
          </div>
          <div>
            <label className={L}>Value 2</label>
            <input {...register('custom_field_2_value')} className={F} placeholder="e.g. 10k–20k, Q2 2026..." />
          </div>
        </div>
        <div>
          <label className={L}>
            Agent Private Notes
            <span className="text-slate-600 ml-1 font-normal">(visible to assigned agent & admin only)</span>
          </label>
          <textarea {...register('agent_private_notes')} rows={2} className={F}
            placeholder="Owner mood, best time to call, personal details shared, objections raised..." />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-5 pb-1">
        {onSuccess && <Button type="button" variant="ghost" onClick={onSuccess}>Cancel</Button>}
        <Button type="submit" loading={loading}>
          {lead ? 'Save Changes' : 'Save Lead'}
        </Button>
      </div>
    </form>
  )
}
