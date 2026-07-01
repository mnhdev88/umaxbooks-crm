'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Lead, Profile } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LeadForm } from './LeadForm'
import {
  Search, Plus, Upload, ExternalLink, X, ChevronLeft, ChevronRight,
  Eye, Edit2, Download, AlertCircle, Filter, ChevronDown, Check, Phone,
} from 'lucide-react'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { CallWindowBadge } from './CallWindowBadge'

// ── Template download helpers ─────────────────────────────────────────────────
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadXlsx(filename: string, rows: string[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Leads')
  XLSX.writeFile(wb, filename)
}

function handleTemplateDownload(template: string) {
  if (template === 'GMB Template (.csv)') {
    downloadCsv('gmb-template.csv', [
      ['company_name','name','phone','email','website_url','address','city','country','gmb_review_rating','number_of_reviews','gmb_url','gmb_category'],
      ['Rick\'s Cleaners','John Smith','+1 512-291-1588','info@rickscleaners.com','rickscleaners.com','8400 Brodie Ln, Austin TX','Austin','US','4.6','396','https://maps.google.com/?cid=123','Dry Cleaning'],
    ])
  } else if (template === 'Cold Call Template (.csv)') {
    downloadCsv('cold-call-template.csv', [
      ['company_name','name','phone','email','website_url','address','city','country','source'],
      ['Acme Corp','Jane Doe','+1 555-000-1234','jane@acme.com','acme.com','123 Main St','New York','US','Cold Call'],
    ])
  } else if (template === 'Full Template (.xlsx)') {
    downloadXlsx('full-template.xlsx', [
      ['company_name','name','phone','email','website_url','social_url','whatsapp_number','address','city','country','source','gmb_review_rating','number_of_reviews','gmb_url','gmb_category','priority','notes'],
      ['Example Business','Contact Name','+1 555-000-0000','email@example.com','example.com','https://instagram.com/example','+1 555-000-0001','123 Main St','Austin','US','GMB','4.5','120','https://maps.google.com/?cid=123','Restaurant','Normal','Sample note'],
    ])
  }
}

// ── Source styling ─────────────────────────────────────────────────
const SRC: Record<string, { label: string; cls: string }> = {
  'GMB':          { label: 'GMB',           cls: 'bg-green-900/40 text-green-400 border border-green-800/40' },
  'Facebook':     { label: 'Facebook / IG', cls: 'bg-blue-900/40 text-blue-400 border border-blue-800/40' },
  'LinkedIn':     { label: 'LinkedIn',      cls: 'bg-sky-900/40 text-sky-400 border border-sky-800/40' },
  'WhatsApp':     { label: 'WhatsApp',      cls: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40' },
  'Referral':     { label: 'Referral',      cls: 'bg-purple-900/40 text-purple-400 border border-purple-800/40' },
  'Cold Call':    { label: 'Cold Call',     cls: 'bg-amber-900/40 text-amber-400 border border-amber-800/40' },
  'Website Form': { label: 'Website',       cls: 'bg-pink-900/40 text-pink-400 border border-pink-800/40' },
  'Other':        { label: 'Other',         cls: 'bg-slate-700/60 text-slate-400 border border-slate-600/40' },
}

const STATUS_CLS: Record<string, string> = {
  'New':            'bg-indigo-900/40 text-indigo-300 border border-indigo-800/40',
  'Contacted':      'bg-amber-900/40 text-amber-300 border border-amber-800/40',
  'Audit Ready':    'bg-blue-900/40 text-blue-300 border border-blue-800/40',
  'Callback Booked': 'bg-cyan-900/40 text-cyan-300 border border-cyan-800/40',
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300 border border-purple-800/40',
  'Demo Done':      'bg-orange-900/40 text-orange-300 border border-orange-800/40',
  'Closed Won':     'bg-green-900/40 text-green-300 border border-green-800/40',
  'Revision':       'bg-pink-900/40 text-pink-300 border border-pink-800/40',
  'Live':           'bg-teal-900/40 text-teal-300 border border-teal-800/40',
  'Completed':      'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40',
  'Lost':           'bg-red-900/40 text-red-300 border border-red-800/40',
  'Disqualified':   'bg-slate-700/40 text-slate-400 border border-slate-600/40',
}

// Ordered list of statuses for the inline quick-edit dropdown (matches the filter).
const STATUSES = [
  'New', 'Contacted', 'Audit Ready', 'Callback Booked', 'Demo Scheduled', 'Demo Done',
  'Closed Won', 'Revision', 'Live', 'Completed', 'Lost', 'Disqualified',
]

const PRIORITY_CLS: Record<string, string> = {
  'Urgent': 'text-red-400',
  'High':   'text-amber-400',
  'Normal': 'text-slate-500',
  'Low':    'text-slate-600',
}

function StarRating({ rating }: { rating?: number }) {
  if (!rating) return <span className="text-slate-600 text-xs">No GMB</span>
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-yellow-400 text-xs tracking-tight">
        {'★'.repeat(Math.min(Math.floor(rating), 5))}{'☆'.repeat(Math.max(0, 5 - Math.floor(rating)))}
      </span>
      <span className="text-slate-400 text-xs">{rating}</span>
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', STATUS_CLS[status] || 'bg-slate-700 text-slate-300')}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  )
}

// Inline quick-edit status control for the All Leads table. Click the badge to
// pick a new status — saves instantly (optimistic) and mirrors the Kanban board:
// it logs an activity entry and fires the status-change notification.
function StatusCell({ lead, userId }: { lead: Lead; userId: string }) {
  const [status, setStatus] = useState<string>(lead.status)
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Resync if the row's status changes underneath us (e.g. router.refresh()).
  useEffect(() => { setStatus(lead.status) }, [lead.status])

  // The status column lives inside an overflow-scrolling table, so anchor the
  // menu with fixed positioning to avoid clipping. Close it when the PAGE
  // scrolls — but NOT when scrolling inside the menu itself.
  useEffect(() => {
    if (!open) return
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      setOpen(false)
    }
    const onResize = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const MENU_H = 288 // max-h-72
      // Keep the (scrollable) menu fully inside the viewport.
      let top = r.bottom + 4
      if (top + MENU_H > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - MENU_H - 8)
      }
      setCoords({ top, left: r.left })
    }
    setOpen(true)
  }

  async function changeStatus(next: string) {
    setOpen(false)
    if (next === status) return
    const prev = status
    setStatus(next)            // optimistic
    setSaving(true)

    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { error } = await supabase
      .from('leads')
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq('id', lead.id)

    if (error) {
      setStatus(prev)
      setSaving(false)
      toast.error('Failed to update status. Reverted.')
      return
    }

    await supabase.from('activity_logs').insert({
      lead_id: lead.id,
      user_id: userId,
      action: 'Status Changed',
      details: `Status changed from "${prev}" to "${next}"`,
    })

    if (next === 'Demo Scheduled' || next === 'Revision') {
      fetch('/api/notifications/status-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id, newStatus: next }),
      }).catch(() => {})
    }

    setSaving(false)
    toast.success(`Status updated to "${next}"`)
  }

  return (
    <>
      <button
        ref={btnRef} type="button" disabled={saving}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={`Change status, currently ${status}`}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 cursor-pointer',
          STATUS_CLS[status] || 'bg-slate-700 text-slate-300'
        )}>
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
        {status}
        <ChevronDown size={11} className="opacity-60" aria-hidden="true" />
      </button>

      {open && coords && (
        <>
          <button type="button" aria-hidden="true" tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div ref={menuRef} role="menu" style={{ position: 'fixed', top: coords.top, left: coords.left }}
            className="z-50 w-44 max-h-72 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl shadow-black/40 py-1">
            {STATUSES.map(s => (
              <button key={s} type="button" role="menuitem" onClick={() => changeStatus(s)}
                className={cn(
                  'flex items-center justify-between w-full text-left px-3 py-1.5 text-xs hover:bg-slate-800 transition-colors',
                  s === status ? 'text-orange-400' : 'text-slate-300'
                )}>
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium', STATUS_CLS[s] || 'bg-slate-700 text-slate-300')}>{s}</span>
                </span>
                {s === status && <Check size={12} className="shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return <span className="text-slate-600 text-xs">—</span>
  const s = SRC[source] || { label: source, cls: 'bg-slate-700 text-slate-400' }
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', s.cls)}>{s.label}</span>
}

// ── File parsing (CSV + Excel) ─────────────────────────────────────
async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { read, utils } = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' })
  if (raw.length < 2) return { headers: [], rows: [] }
  const headers = (raw[0] as any[]).map(h => String(h ?? '').trim()).filter(Boolean)
  const rows = raw.slice(1)
    .filter((r: any[]) => r.some(c => c !== '' && c != null))
    .map((r: any[]) =>
      headers.reduce((o, h, i) => ({ ...o, [h]: String(r[i] ?? '').trim() }), {} as Record<string, string>)
    )
  return { headers, rows }
}

const CRM_FIELDS = [
  'company_name', 'name', 'phone', 'email', 'city', 'address',
  'website_url', 'gmb_url', 'gmb_review_rating', 'number_of_reviews', 'gmb_category', '— Skip —',
]

interface Stats { total: number; newCt: number; gmb: number; demo: number; closed: number; social: number }
interface Filters { tab: string; q: string; src: string; status: string; assignee: string; city: string }

interface Props {
  leads: Lead[]
  stats: Stats
  cities: string[]
  totalCount: number
  page: number
  perPage: number
  filters: Filters
  agents: Profile[]
  profile: Profile
  userId: string
  filterBanner?: string
  sortCallable: boolean
  callWindow: { start: string; end: string }
}

export function LeadsPageClient({
  leads, stats, cities, totalCount, page, perPage, filters, agents, profile, userId, filterBanner,
  sortCallable, callWindow,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput]   = useState(filters.q)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [loadingEdit, setLoadingEdit]   = useState(false)

  // Add / Edit modal
  const [showAdd, setShowAdd]         = useState(false)
  const [editLead, setEditLead]       = useState<Lead | null>(null)

  // Bulk import modal
  const [showImport, setShowImport]   = useState(false)
  const [importStep, setImportStep]   = useState(1)
  const [csvFile, setCsvFile]         = useState<File | null>(null)
  const [csvHeaders, setCsvHeaders]   = useState<string[]>([])
  const [csvRows, setCsvRows]         = useState<Record<string, string>[]>([])
  const [fieldMap, setFieldMap]       = useState<Record<string, string>>({})
  const [importing, setImporting]     = useState(false)
  const [parseError, setParseError]   = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ ok: number; dup: number; err: number; log: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Keep the search box in sync when the URL changes elsewhere (e.g. "Clear filter").
  useEffect(() => { setSearchInput(filters.q) }, [filters.q])

  // ── URL-driven filtering ───────────────────────────────────────
  // The server reads these params and returns the matching page, so filters /
  // search / paging never load the whole table into the browser.
  function setParams(updates: Record<string, string | null>, resetPage = true) {
    const params = new URLSearchParams(searchParams.toString())
    if (resetPage) params.delete('page')
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    const qs = params.toString()
    router.push(qs ? `/leads?${qs}` : '/leads')
  }

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onSearchChange(v: string) {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setParams({ q: v.trim() || null }), 350)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / perPage))
  const anyFilter = Boolean(searchInput || filters.src || filters.status || filters.assignee || filters.city || (filters.tab && filters.tab !== 'all'))

  // ── Tabs (counts come from server-side aggregates) ─────────────
  const tabs = [
    { id: 'all',    label: `All Leads (${stats.total})` },
    { id: 'new',    label: `New (${stats.newCt})` },
    { id: 'gmb',    label: `GMB (${stats.gmb})` },
    { id: 'social', label: `Social (${stats.social})` },
    { id: 'other',  label: `Other (${stats.total - stats.gmb - stats.social})` },
  ]

  function goToPage(p: number) {
    setParams({ page: String(Math.min(Math.max(1, p), totalPages)) }, false)
  }

  // ── Bulk select (current page) ─────────────────────────────────
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(leads.map(l => l.id)) : new Set())
  }

  // Edit needs every column; the list query is narrowed, so fetch the full row.
  async function openEdit(id: string) {
    setLoadingEdit(true)
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data } = await supabase.from('leads').select('*').eq('id', id).single()
    setLoadingEdit(false)
    if (data) setEditLead(data as Lead)
  }

  // ── File upload (CSV / Excel) ──────────────────────────────────
  async function handleCsvFile(file: File) {
    setCsvFile(file)
    setParseError(null)
    try {
      const { headers, rows } = await parseFile(file)
      if (headers.length === 0) {
        setParseError('Could not read file — make sure the first row contains column headers.')
        return
      }
      setCsvHeaders(headers)
      setCsvRows(rows)
      const auto: Record<string, string> = {}
      headers.forEach(h => {
        const hl = h.toLowerCase().replace(/[\s_\-]+/g, ' ').trim()
        if (
          hl.includes('business') || hl.includes('company') ||
          hl.includes('client') || hl.includes('salon') ||
          hl.includes('store') || hl.includes('shop') ||
          hl.includes('restaurant') || hl.includes('organisation') ||
          hl.includes('organization') || hl === 'title' ||
          hl === 'account' || hl.includes('brand')
        ) auto[h] = 'company_name'
        else if (
          hl === 'name' || hl === 'full name' || hl === 'fullname' ||
          hl.includes('contact') || hl.includes('owner') || hl.includes('person')
        ) auto[h] = 'name'
        else if (hl.includes('phone') || hl.includes('mobile') || hl.includes('tel') || hl.includes('cell')) auto[h] = 'phone'
        else if (hl.includes('email')) auto[h] = 'email'
        else if (hl === 'city' || hl.includes('town') || hl.includes('suburb')) auto[h] = 'city'
        else if (hl.includes('address')) auto[h] = 'address'
        else if (hl.includes('website') || hl.includes('web') || hl.includes('url') || hl.includes('site')) auto[h] = 'website_url'
        else if (hl.includes('gmb') || hl.includes('google') || hl.includes('map')) auto[h] = 'gmb_url'
        else if (hl.includes('rating') || hl === 'stars' || hl === 'score') auto[h] = 'gmb_review_rating'
        else if (hl.includes('review') || hl.includes('reviews')) auto[h] = 'number_of_reviews'
        else if (hl.includes('category') || hl.includes('industry') || hl.includes('niche')) auto[h] = 'gmb_category'
        else auto[h] = '— Skip —'
      })
      setFieldMap(auto)
      setImportStep(2)
    } catch (e: any) {
      setParseError(e.message || 'Failed to read file.')
    }
  }

  async function runImport() {
    setImporting(true)
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    let ok = 0, dup = 0, err = 0
    const log: string[] = []

    const { slugify } = await import('@/lib/utils')

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]
      const record: Record<string, any> = { source: 'GMB', status: 'New', priority: 'Normal', created_by: userId }
      Object.entries(fieldMap).forEach(([csvCol, crmField]) => {
        if (crmField !== '— Skip —' && row[csvCol]) record[crmField] = row[csvCol]
      })
      if (!record.company_name) { err++; log.push(`Row ${i + 2}: Missing company name — skipped`); continue }
      if (!record.name) record.name = record.company_name
      record.slug = slugify(record.company_name) + '-' + Date.now() + i
      record.gmb_review_rating = record.gmb_review_rating ? parseFloat(record.gmb_review_rating) : null
      record.number_of_reviews = record.number_of_reviews ? parseInt(record.number_of_reviews) : null
      const { error } = await supabase.from('leads').insert(record)
      if (error) {
        // The DB enforces uniqueness on company/phone/email; treat a constraint
        // hit as a duplicate (the browser no longer holds every lead to pre-check).
        const isDup = error.code === '23505' || /duplicate|unique/i.test(error.message)
        if (isDup) { dup++; log.push(`Row ${i + 2}: Duplicate — ${record.company_name} (skipped)`) }
        else { err++; log.push(`Row ${i + 2}: Error — ${error.message}`) }
      } else { ok++; log.push(`Row ${i + 2}: Imported — ${record.company_name}`) }
    }

    setImportResult({ ok, dup, err, log })
    setImportStep(3)
    setImporting(false)
    router.refresh()
  }

  function resetImport() {
    setCsvFile(null); setCsvHeaders([]); setCsvRows([]); setFieldMap({})
    setImportResult(null); setImportStep(1); setParseError(null)
    setShowImport(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const canEdit = profile.role !== 'developer'

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">

      {/* Filter banner from Reports drill-down */}
      {filterBanner && (
        <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2.5">
          <Filter size={13} className="text-orange-400 shrink-0" />
          <span className="text-sm text-orange-300 font-medium flex-1">{filterBanner}</span>
          <Link href="/leads" className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg px-2.5 py-1 transition-colors">
            Clear filter
          </Link>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Leads',       val: stats.total,  sub: '+' + Math.min(stats.total, 6) + ' this week', accent: true },
          { label: 'New (Uncontacted)', val: stats.newCt,  sub: 'Needs follow-up',    color: 'text-indigo-400' },
          { label: 'GMB Source',        val: stats.gmb,    sub: `${stats.total ? Math.round(stats.gmb/stats.total*100) : 0}% of total`, color: 'text-green-400' },
          { label: 'Demo Scheduled',    val: stats.demo,   sub: 'This week',          color: 'text-purple-400' },
          { label: 'Closed Won',        val: stats.closed, sub: 'This month',         color: 'text-emerald-400' },
        ].map(s => (
          <div key={s.label} className={cn(
            'bg-slate-900 border rounded-xl px-4 py-3.5',
            s.accent ? 'border-orange-500/30' : 'border-slate-800'
          )}>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1.5">{s.label}</p>
            <p className={cn('text-2xl font-semibold tracking-tight', s.accent ? 'text-orange-400' : s.color)}>{s.val}</p>
            <p className="text-xs text-slate-600 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 w-full overflow-x-auto md:w-fit">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setParams({ tab: t.id === 'all' ? null : t.id })}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
              filters.tab === t.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-500 hover:text-slate-300'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchInput} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search by name, company, city, website, phone..."
            aria-label="Search leads"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus:border-orange-500"
          />
        </div>
        {[
          { key: 'src',      val: filters.src,      opts: ['GMB','Facebook','LinkedIn','WhatsApp','Referral','Cold Call','Website Form','Other'], placeholder: 'All Sources' },
          { key: 'status',   val: filters.status,   opts: STATUSES, placeholder: 'All Status' },
          { key: 'assignee', val: filters.assignee, opts: agents.map(a => a.id), labels: agents.map(a => a.full_name), placeholder: 'All Agents' },
          { key: 'city',     val: filters.city,     opts: cities as string[], placeholder: 'All Cities' },
        ].map((f, i) => (
          <select key={i} value={f.val} onChange={e => setParams({ [f.key]: e.target.value || null })}
            aria-label={f.placeholder}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus:border-orange-500 cursor-pointer">
            <option value="">{f.placeholder}</option>
            {f.opts.map((o, j) => <option key={o} value={o}>{f.labels ? f.labels[j] : o}</option>)}
          </select>
        ))}
        <button
          type="button"
          onClick={() => setParams({ sort: sortCallable ? null : 'callable' })}
          aria-pressed={sortCallable}
          title="Sort leads it's currently past the local calling time for to the top"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium border transition-colors',
            sortCallable
              ? 'bg-orange-500/15 border-orange-500/50 text-orange-300'
              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
          )}>
          <Phone size={13} /> Call-ready first
        </button>
        {canEdit && <>
          <Button variant="ghost" size="sm" onClick={() => setShowImport(true)}>
            <Upload size={13} /> Bulk Import
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={13} /> Add Lead
          </Button>
        </>}
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/60">
              <tr>
                {canEdit && (
                  <th scope="col" className="w-9 px-3 py-3">
                    <input type="checkbox" className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                      aria-label="Select all leads"
                      onChange={e => toggleAll(e.target.checked)} />
                  </th>
                )}
                {['Lead ID','Lead / Company','Source','Location','Call Window','Website','GMB Rating','Last Seen','Status','Assigned','Added',''].map(h => (
                  <th scope="col" key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap border-b border-slate-800">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id} className={cn(
                  'border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors',
                  selectedIds.has(lead.id) && 'bg-orange-900/10'
                )}>
                  {canEdit && (
                    <td className="px-3 py-3">
                      <input type="checkbox" className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                        aria-label={`Select ${lead.name}`}
                        checked={selectedIds.has(lead.id)}
                        onChange={e => {
                          const n = new Set(selectedIds)
                          e.target.checked ? n.add(lead.id) : n.delete(lead.id)
                          setSelectedIds(n)
                        }} />
                    </td>
                  )}
                  <td className="px-3 py-3 whitespace-nowrap">
                    {lead.lead_number ? (
                      <Link href={`/leads/${lead.id}`}
                        className="inline-flex font-mono text-[11px] font-semibold px-2 py-1 rounded-md bg-slate-800 text-orange-400/90 border border-slate-700 hover:border-orange-500/50 hover:text-orange-400 transition-colors">
                        NVL-{String(lead.lead_number).padStart(3, '0')}
                      </Link>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-semibold text-slate-100 text-sm hover:text-orange-400 transition-colors">{lead.name}</Link>
                    <p className="text-xs text-slate-500 mt-0.5">{lead.company_name}</p>
                    {lead.priority && lead.priority !== 'Normal' && (
                      <span className={cn('text-xs font-semibold', PRIORITY_CLS[lead.priority])}>
                        ↑ {lead.priority}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <SourceBadge source={lead.source} />
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-400">
                    {lead.city || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <CallWindowBadge
                      timeZone={(lead as any).timezone}
                      windowStart={callWindow.start}
                      windowEnd={callWindow.end}
                    />
                  </td>
                  <td className="px-3 py-3 max-w-[160px]">
                    {lead.website_url
                      ? <a href={lead.website_url} target="_blank" rel="noreferrer" title={lead.website_url}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline block truncate">
                          {lead.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      : <span className="text-slate-600 text-xs">No website</span>
                    }
                  </td>
                  <td className="px-3 py-3">
                    <StarRating rating={lead.gmb_review_rating} />
                    {lead.number_of_reviews ? (
                      <p className="text-xs text-slate-600 mt-0.5">({lead.number_of_reviews} reviews)</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {lead.gmb_last_seen ? new Date(lead.gmb_last_seen).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {canEdit
                      ? <StatusCell lead={lead} userId={userId} />
                      : <StatusBadge status={lead.status} />}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-400">
                    {(lead as any).assigned_agent?.full_name || <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {formatDate(lead.created_at)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/leads/${lead.id}`}
                        aria-label={`View ${lead.name}`}
                        className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
                        <Eye size={14} aria-hidden="true" />
                      </Link>
                      {canEdit && (
                        <button onClick={() => openEdit(lead.id)} disabled={loadingEdit}
                          aria-label={`Edit ${lead.name}`}
                          className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors disabled:opacity-50">
                          <Edit2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-500">
                    {anyFilter ? 'No leads match your filters.' : 'No leads yet. Add your first lead!'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
          <span>Showing {totalCount === 0 ? 0 : (page - 1) * perPage + 1}–{Math.min(page * perPage, totalCount)} of {totalCount} leads</span>
          <div className="flex items-center gap-1">
            <button onClick={() => goToPage(page - 1)} disabled={page === 1}
              aria-label="Previous page"
              className="w-8 h-8 flex items-center justify-center rounded border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={13} aria-hidden="true" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page - 2 + i
              if (p > totalPages) return null
              return (
                <button key={p} onClick={() => goToPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                  className={cn('w-8 h-8 flex items-center justify-center rounded border text-xs',
                    p === page ? 'border-orange-500 text-orange-400 bg-orange-900/20' : 'border-slate-700 text-slate-400 hover:bg-slate-800')}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages}
              aria-label="Next page"
              className="w-8 h-8 flex items-center justify-center rounded border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Lead Modal ─────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowAdd(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add New Lead" className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Add New Lead</p>
                <p className="text-xs text-slate-500 mt-0.5">Fill all required fields. GMB fields auto-populate when URL is entered.</p>
              </div>
              <button onClick={() => setShowAdd(false)} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <LeadForm
                agents={agents}
                userId={userId}
                userRole={profile.role}
                onSuccess={() => { setShowAdd(false); router.refresh() }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Lead Modal ────────────────────────────────────── */}
      {editLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setEditLead(null)}>
          <div role="dialog" aria-modal="true" aria-label="Edit Lead" className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Edit Lead</p>
                <p className="text-xs text-slate-500 mt-0.5">{editLead.company_name}</p>
              </div>
              <button onClick={() => setEditLead(null)} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <LeadForm
                lead={editLead}
                agents={agents}
                userId={userId}
                userRole={profile.role}
                onSuccess={() => { setEditLead(null); router.refresh() }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Import Modal ──────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={resetImport}>
          <div role="dialog" aria-modal="true" aria-label="Bulk Import Leads" className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Bulk Import Leads</p>
                <p className="text-xs text-slate-500 mt-0.5">Upload CSV · Map columns · Preview · Import</p>
              </div>
              <button onClick={resetImport} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">

              {/* Step 1: Upload */}
              {importStep === 1 && (
                <div className="space-y-4">
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-orange-500 rounded-xl p-10 text-center cursor-pointer transition-colors group"
                  >
                    <Upload size={32} className="text-slate-600 group-hover:text-orange-500 mx-auto mb-3 transition-colors" />
                    <p className="text-sm font-medium text-slate-300 mb-1">Drop your CSV or Excel file here</p>
                    <p className="text-xs text-slate-500">Supports .csv, .xlsx, .xls · Max 1,000 rows per import</p>
                    <Button size="sm" variant="ghost" className="mt-3">Browse File</Button>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                      onChange={e => { if (e.target.files?.[0]) handleCsvFile(e.target.files[0]) }} />
                  </div>

                  {parseError && (
                    <div className="flex items-center gap-2 text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2.5">
                      <AlertCircle size={13} className="flex-shrink-0" />
                      {parseError}
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Download Templates</p>
                    <div className="flex gap-2">
                      {['GMB Template (.csv)', 'Cold Call Template (.csv)', 'Full Template (.xlsx)'].map(t => (
                        <button key={t} onClick={() => handleTemplateDownload(t)} className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg px-3 py-2 hover:border-slate-500 hover:text-slate-200 transition-colors">
                          <Download size={11} /> {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Map + Preview */}
              {importStep === 2 && (
                <div className="space-y-4">
                  {!Object.values(fieldMap).includes('company_name') && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2.5">
                      <AlertCircle size={13} className="flex-shrink-0" />
                      <span><strong>No column mapped to Company Name.</strong> Find the column with the business name and map it to <em>company_name</em> below — it&apos;s required.</span>
                    </div>
                  )}
                  <div className="bg-slate-800 rounded-xl overflow-hidden border border-slate-700">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-slate-700/50 border-b border-slate-700">
                      <span className="text-xs font-medium text-slate-300">{csvFile?.name} · {csvRows.length} rows detected</span>
                      <span className="text-xs text-green-400 font-medium">File valid</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr>
                            {csvHeaders.slice(0, 6).map(h => (
                              <th scope="col" key={h} className="px-3 py-2 text-left text-slate-500 border-b border-slate-700 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.slice(0, 3).map((row, i) => (
                            <tr key={i} className="border-b border-slate-700/50">
                              {csvHeaders.slice(0, 6).map(h => (
                                <td key={h} className="px-3 py-2 text-slate-400 max-w-[100px] truncate">{row[h] || '—'}</td>
                              ))}
                            </tr>
                          ))}
                          {csvRows.length > 3 && (
                            <tr><td colSpan={6} className="px-3 py-2 text-slate-600">+ {csvRows.length - 3} more rows…</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Map CSV Columns to CRM Fields</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-800">
                          <th scope="col" className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Your Column</th>
                          <th scope="col" className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Sample</th>
                          <th scope="col" className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Map to CRM Field</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvHeaders.map(h => (
                          <tr key={h} className={fieldMap[h] === 'company_name' ? 'bg-orange-900/10' : ''}>
                            <td className="px-3 py-2 font-mono text-slate-400 border border-slate-800">{h}</td>
                            <td className="px-3 py-2 font-mono text-slate-500 border border-slate-800 truncate max-w-[100px]">{csvRows[0]?.[h] || '—'}</td>
                            <td className="px-3 py-2 border border-slate-800">
                              <select value={fieldMap[h] || '— Skip —'}
                                onChange={e => setFieldMap(prev => ({ ...prev, [h]: e.target.value }))}
                                className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-orange-500">
                                {CRM_FIELDS.map(f => <option key={f}>{f}</option>)}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Step 3: Results */}
              {importStep === 3 && importResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-900/20 border border-green-800/30 rounded-xl p-4 text-center">
                      <p className="text-2xl font-bold text-green-400">{importResult.ok}</p>
                      <p className="text-xs text-slate-500 mt-1">Imported successfully</p>
                    </div>
                    <div className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-4 text-center">
                      <p className="text-2xl font-bold text-amber-400">{importResult.dup}</p>
                      <p className="text-xs text-slate-500 mt-1">Duplicates skipped</p>
                    </div>
                    <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4 text-center">
                      <p className="text-2xl font-bold text-red-400">{importResult.err}</p>
                      <p className="text-xs text-slate-500 mt-1">Errors</p>
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-xl p-4 max-h-48 overflow-y-auto space-y-1">
                    <p className="text-xs font-semibold text-slate-300 mb-2">Import log</p>
                    {importResult.log.map((line, i) => (
                      <p key={i} className={cn('text-xs', line.includes('Imported') ? 'text-green-400' : line.includes('Duplicate') ? 'text-amber-400' : 'text-red-400')}>
                        {line.includes('Imported') ? '✓' : line.includes('Duplicate') ? '⚠' : '✗'} {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-800 flex justify-between items-center flex-shrink-0">
              <div className="flex gap-2">
                {importStep === 2 && (
                  <Button variant="ghost" size="sm" onClick={() => setImportStep(1)}>
                    ← Back
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={resetImport}>
                  {importStep === 3 ? 'Close' : 'Cancel'}
                </Button>
                {importStep === 1 && (
                  <Button size="sm" disabled>
                    Preview File →
                  </Button>
                )}
                {importStep === 2 && (
                  <Button
                    size="sm"
                    onClick={runImport}
                    loading={importing}
                    disabled={importing || !Object.values(fieldMap).includes('company_name')}
                    title={!Object.values(fieldMap).includes('company_name') ? 'Map a column to company_name first' : undefined}
                  >
                    Import {csvRows.length} Leads →
                  </Button>
                )}
                {importStep === 3 && (
                  <Button size="sm" onClick={resetImport}>
                    Done
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
