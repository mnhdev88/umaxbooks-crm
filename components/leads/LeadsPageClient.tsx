'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Lead, Profile } from '@/types'
import { cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LeadForm } from './LeadForm'
import {
  Search, Plus, Upload, ExternalLink, X, ChevronLeft, ChevronRight,
  Eye, Edit2, Download, AlertCircle, CheckCircle,
} from 'lucide-react'

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
  'Demo Scheduled': 'bg-purple-900/40 text-purple-300 border border-purple-800/40',
  'Demo Done':      'bg-orange-900/40 text-orange-300 border border-orange-800/40',
  'Closed Won':     'bg-green-900/40 text-green-300 border border-green-800/40',
  'Revision':       'bg-pink-900/40 text-pink-300 border border-pink-800/40',
  'Live':           'bg-teal-900/40 text-teal-300 border border-teal-800/40',
  'Completed':      'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40',
  'Lost':           'bg-red-900/40 text-red-300 border border-red-800/40',
}

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

const PER_PAGE = 10

interface Props {
  initialLeads: Lead[]
  agents: Profile[]
  profile: Profile
  userId: string
}

export function LeadsPageClient({ initialLeads, agents, profile, userId }: Props) {
  const router = useRouter()
  const [search, setSearch]           = useState('')
  const [srcFilter, setSrcFilter]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [cityFilter, setCityFilter]   = useState('')
  const [activeTab, setActiveTab]     = useState('all')
  const [page, setPage]               = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

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

  // ── Stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:  initialLeads.length,
    newCt:  initialLeads.filter(l => l.status === 'New').length,
    gmb:    initialLeads.filter(l => l.source === 'GMB').length,
    demo:   initialLeads.filter(l => l.status === 'Demo Scheduled').length,
    closed: initialLeads.filter(l => l.status === 'Closed Won').length,
    social: initialLeads.filter(l => l.source === 'Facebook' || l.source === 'LinkedIn').length,
  }), [initialLeads])

  // ── Tabs ───────────────────────────────────────────────────────
  const tabs = [
    { id: 'all',    label: `All Leads (${initialLeads.length})` },
    { id: 'new',    label: `New (${stats.newCt})` },
    { id: 'gmb',    label: `GMB (${stats.gmb})` },
    { id: 'social', label: `Social (${stats.social})` },
    { id: 'other',  label: `Other (${initialLeads.length - stats.gmb - stats.social})` },
  ]

  // ── Filtered leads ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = initialLeads
    if (activeTab === 'new')    data = data.filter(l => l.status === 'New')
    else if (activeTab === 'gmb')    data = data.filter(l => l.source === 'GMB')
    else if (activeTab === 'social') data = data.filter(l => l.source === 'Facebook' || l.source === 'LinkedIn')
    else if (activeTab === 'other')  data = data.filter(l => !l.source || !['GMB','Facebook','LinkedIn'].includes(l.source))
    if (search) {
      const q = search.toLowerCase()
      data = data.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.company_name.toLowerCase().includes(q) ||
        (l.city || '').toLowerCase().includes(q) ||
        (l.website_url || '').toLowerCase().includes(q)
      )
    }
    if (srcFilter)    data = data.filter(l => l.source === srcFilter)
    if (statusFilter) data = data.filter(l => l.status === statusFilter)
    if (agentFilter)  data = data.filter(l => l.assigned_agent_id === agentFilter)
    if (cityFilter)   data = data.filter(l => l.city === cityFilter)
    return data
  }, [initialLeads, search, srcFilter, statusFilter, agentFilter, cityFilter, activeTab])

  useEffect(() => setPage(1), [search, srcFilter, statusFilter, agentFilter, cityFilter, activeTab])

  const totalPages = Math.ceil(filtered.length / PER_PAGE)
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const cities = useMemo(() => [...new Set(initialLeads.map(l => l.city).filter(Boolean))].sort(), [initialLeads])

  // ── Bulk select ────────────────────────────────────────────────
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(paginated.map(l => l.id)) : new Set())
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

    const existingNames = new Set(initialLeads.map(l => l.company_name.toLowerCase()))
    const { slugify } = await import('@/lib/utils')

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i]
      const record: Record<string, any> = { source: 'GMB', status: 'New', priority: 'Normal' }
      Object.entries(fieldMap).forEach(([csvCol, crmField]) => {
        if (crmField !== '— Skip —' && row[csvCol]) record[crmField] = row[csvCol]
      })
      if (!record.company_name) { err++; log.push(`Row ${i + 2}: Missing company name — skipped`); continue }
      if (!record.name) record.name = record.company_name
      if (existingNames.has(record.company_name.toLowerCase())) {
        dup++; log.push(`Row ${i + 2}: Duplicate — ${record.company_name} (skipped)`); continue
      }
      record.slug = slugify(record.company_name) + '-' + Date.now() + i
      record.gmb_review_rating = record.gmb_review_rating ? parseFloat(record.gmb_review_rating) : null
      record.number_of_reviews = record.number_of_reviews ? parseInt(record.number_of_reviews) : null
      const { error } = await supabase.from('leads').insert(record)
      if (error) { err++; log.push(`Row ${i + 2}: Error — ${error.message}`) }
      else { ok++; log.push(`Row ${i + 2}: Imported — ${record.company_name}`) }
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
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
              activeTab === t.id
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
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, company, city, website..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>
        {[
          { val: srcFilter,    set: setSrcFilter,    opts: ['GMB','Facebook','LinkedIn','WhatsApp','Referral','Cold Call','Website Form','Other'], placeholder: 'All Sources' },
          { val: statusFilter, set: setStatusFilter, opts: ['New','Contacted','Audit Ready','Demo Scheduled','Demo Done','Closed Won','Revision','Live','Completed','Lost'], placeholder: 'All Status' },
          { val: agentFilter,  set: setAgentFilter,  opts: agents.map(a => a.id), labels: agents.map(a => a.full_name), placeholder: 'All Agents' },
          { val: cityFilter,   set: setCityFilter,   opts: cities as string[], placeholder: 'All Cities' },
        ].map((f, i) => (
          <select key={i} value={f.val} onChange={e => f.set(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-400 focus:outline-none focus:border-orange-500 cursor-pointer">
            <option value="">{f.placeholder}</option>
            {f.opts.map((o, j) => <option key={o} value={o}>{f.labels ? f.labels[j] : o}</option>)}
          </select>
        ))}
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
                  <th className="w-9 px-3 py-3">
                    <input type="checkbox" className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                      onChange={e => toggleAll(e.target.checked)} />
                  </th>
                )}
                {['Lead / Company','Source','Location','Website','GMB Rating','Last Seen','Competitors','Status','Assigned','Added',''].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap border-b border-slate-800">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map(lead => (
                <tr key={lead.id} className={cn(
                  'border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors',
                  selectedIds.has(lead.id) && 'bg-orange-900/10'
                )}>
                  {canEdit && (
                    <td className="px-3 py-3">
                      <input type="checkbox" className="accent-orange-500 w-3.5 h-3.5 cursor-pointer"
                        checked={selectedIds.has(lead.id)}
                        onChange={e => {
                          const n = new Set(selectedIds)
                          e.target.checked ? n.add(lead.id) : n.delete(lead.id)
                          setSelectedIds(n)
                        }} />
                    </td>
                  )}
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
                    {lead.website_url
                      ? <a href={lead.website_url} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline">
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
                    {lead.competitor_count != null && lead.competitor_count > 0 ? (
                      <span className={cn('text-xs font-medium', lead.competitor_count >= 7 ? 'text-red-400' : lead.competitor_count >= 4 ? 'text-amber-400' : 'text-green-400')}>
                        {lead.competitor_count} nearby
                      </span>
                    ) : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={lead.status} />
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
                        className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
                        <Eye size={12} />
                      </Link>
                      {canEdit && (
                        <button onClick={() => setEditLead(lead)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500 transition-colors">
                          <Edit2 size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-slate-500">
                    {search || srcFilter || statusFilter || agentFilter || cityFilter ? 'No leads match your filters.' : 'No leads yet. Add your first lead!'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
          <span>Showing {Math.min((page - 1) * PER_PAGE + 1, filtered.length)}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} leads</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="w-7 h-7 flex items-center justify-center rounded border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={13} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page - 2 + i
              if (p > totalPages) return null
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={cn('w-7 h-7 flex items-center justify-center rounded border text-xs',
                    p === page ? 'border-orange-500 text-orange-400 bg-orange-900/20' : 'border-slate-700 text-slate-400 hover:bg-slate-800')}>
                  {p}
                </button>
              )
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}
              className="w-7 h-7 flex items-center justify-center rounded border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Add Lead Modal ─────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Add New Lead</p>
                <p className="text-xs text-slate-500 mt-0.5">Fill all required fields. GMB fields auto-populate when URL is entered.</p>
              </div>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <LeadForm
                agents={agents}
                userId={userId}
                existingLeads={initialLeads}
                onSuccess={() => { setShowAdd(false); router.refresh() }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Lead Modal ────────────────────────────────────── */}
      {editLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setEditLead(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Edit Lead</p>
                <p className="text-xs text-slate-500 mt-0.5">{editLead.company_name}</p>
              </div>
              <button onClick={() => setEditLead(null)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <LeadForm
                lead={editLead}
                agents={agents}
                userId={userId}
                onSuccess={() => { setEditLead(null); router.refresh() }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Import Modal ──────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={resetImport}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
              <div>
                <p className="text-base font-semibold text-slate-100">Bulk Import Leads</p>
                <p className="text-xs text-slate-500 mt-0.5">Upload CSV · Map columns · Preview · Import</p>
              </div>
              <button onClick={resetImport} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500">
                <X size={14} />
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
                        <button key={t} className="flex items-center gap-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg px-3 py-2 hover:border-slate-500 hover:text-slate-200 transition-colors">
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
                              <th key={h} className="px-3 py-2 text-left text-slate-500 border-b border-slate-700 font-medium">{h}</th>
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
                          <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Your Column</th>
                          <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Sample</th>
                          <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase tracking-wide border border-slate-700">Map to CRM Field</th>
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
