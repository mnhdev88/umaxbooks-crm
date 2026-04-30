'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { slugify, cn } from '@/lib/utils'
import { Lead, LeadSource, Profile, PIPELINE_STAGES } from '@/types'
import { useRouter } from 'next/navigation'
import { AlertCircle, Loader2, CheckCircle2, Sparkles } from 'lucide-react'

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

const schema = z.object({
  name:                  z.string().min(1, 'Required'),
  company_name:          z.string().min(1, 'Required'),
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
  existingLeads?: Lead[]
}

export function LeadForm({ lead, agents, onSuccess, userId, existingLeads = [] }: LeadFormProps) {
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [source, setSource]             = useState<LeadSource>(lead?.source || 'GMB')
  const [stars, setStars]               = useState(() => {
    const n = lead?.gmb_review_rating || 0
    return '★'.repeat(Math.min(Math.floor(n), 5)) + '☆'.repeat(Math.max(0, 5 - Math.floor(n)))
  })
  const [extracting, setExtracting]     = useState(false)
  const [extractSuccess, setExtractSuccess] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const extractTimerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:                 lead?.name || '',
      company_name:         lead?.company_name || '',
      phone:                lead?.phone || '',
      email:                lead?.email || '',
      address:              lead?.address || '',
      city:                 lead?.city || '',
      zip_code:             lead?.zip_code || '',
      country:              lead?.country || 'India',
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

  const watchedCompany = watch('company_name')
  const watchedGmbUrl  = watch('gmb_url')

  const duplicate = !lead && watchedCompany?.length > 2
    ? existingLeads.find(l =>
        l.company_name.toLowerCase().includes(watchedCompany.toLowerCase())
      )
    : null

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

  // Watch GMB URL and auto-extract after 600 ms debounce
  useEffect(() => {
    if (!watchedGmbUrl || !isGmbUrl(watchedGmbUrl)) return
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
    const payload = {
      ...data,
      source,
      gmb_review_rating:  data.gmb_review_rating  ? parseFloat(data.gmb_review_rating)  : null,
      number_of_reviews:  data.number_of_reviews  ? parseInt(data.number_of_reviews)    : null,
      competitor_count:   data.competitor_count   ? parseInt(data.competitor_count)     : null,
      assigned_agent_id:  data.assigned_agent_id  || null,
      slug: lead?.slug || slugify(data.company_name) + '-' + Date.now(),
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

  const F = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 transition-colors'
  const L = 'text-xs font-medium text-slate-400 mb-1 block'
  const S = 'text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2 after:flex-1 after:h-px after:bg-slate-800 mt-5 mb-3'

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
                <div className="flex items-center gap-2">
                  <input {...register('gmb_review_rating')} type="number" min="1" max="5" step="0.1"
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-orange-500"
                    placeholder="4.5" onChange={e => updateStars(e.target.value)} />
                  <span className="text-yellow-400 text-sm tracking-tight">{stars}</span>
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

      {/* ── Duplicate warning ───────────────────────────────── */}
      {duplicate && (
        <div className="flex items-center gap-2 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2.5 text-xs text-amber-300 mt-3">
          <AlertCircle size={13} className="flex-shrink-0" />
          Possible duplicate: <strong className="ml-1">{duplicate.company_name}</strong> already exists — check before saving.
        </div>
      )}

      {/* ── Contact Information ─────────────────────────────── */}
      <p className={S}>Contact Information</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={L}>Contact Name <span className="text-orange-500">*</span></label>
          <input {...register('name')} className={cn(F, errors.name && 'border-red-600')} placeholder="Dr. Ramesh Sharma" />
          {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name.message}</p>}
        </div>
        <div>
          <label className={L}>Company / Business Name <span className="text-orange-500">*</span></label>
          <input {...register('company_name')} className={cn(F, errors.company_name && 'border-red-600')} placeholder="Sharma Dental Clinic" />
          {errors.company_name && <p className="text-xs text-red-400 mt-1">{errors.company_name.message}</p>}
        </div>
        <div>
          <label className={L}>Phone Number</label>
          <input {...register('phone')} type="tel" className={F} placeholder="+91 98XXXXXXXX" />
        </div>
        <div>
          <label className={L}>Email ID</label>
          <input {...register('email')} type="email" className={cn(F, errors.email && 'border-red-600')} placeholder="dr@email.com" />
          {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email.message}</p>}
        </div>
      </div>

      {/* ── Location ────────────────────────────────────────── */}
      <p className={S}>Location</p>
      <div className="space-y-3">
        <div>
          <label className={L}>Address</label>
          <input {...register('address')} className={F} placeholder="Shop 12, Sector 14, Dwarka" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={L}>City</label>
            <input {...register('city')} className={F} placeholder="New Delhi" />
          </div>
          <div>
            <label className={L}>ZIP / Pin Code</label>
            <input {...register('zip_code')} className={F} placeholder="110075" />
          </div>
          <div>
            <label className={L}>Country</label>
            <select {...register('country')} className={cn(F, 'cursor-pointer')}>
              <option>India</option>
              <option>USA</option>
              <option>UAE</option>
              <option>UK</option>
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
          <input {...register('website_url')} type="url" className={F} placeholder="https://sharmadental.in" />
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
          <input {...register('whatsapp_number')} type="tel" className={F} placeholder="+91 98XXXXXXXX" />
        </div>
      </div>

      {/* ── Assignment & Priority ───────────────────────────── */}
      <p className={S}>Assignment & Priority</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={L}>Assign to Agent</label>
          <select {...register('assigned_agent_id')} className={cn(F, 'cursor-pointer')}>
            <option value="">— Unassigned —</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
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
            <input {...register('custom_field_1_value')} className={F} placeholder="e.g. Raj Malhotra, BNI Delhi..." />
          </div>
          <div>
            <label className={L}>Label 2</label>
            <input {...register('custom_field_2_label')} className={F} placeholder="e.g. Budget range, Timeline..." />
          </div>
          <div>
            <label className={L}>Value 2</label>
            <input {...register('custom_field_2_value')} className={F} placeholder="e.g. ₹20k–₹50k, Q2 2026..." />
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
        <Button type="button" variant="ghost" onClick={onSuccess}>Save as Draft</Button>
        <Button type="submit" loading={loading}>
          {lead ? 'Save Changes' : 'Save Lead'}
        </Button>
      </div>
    </form>
  )
}
