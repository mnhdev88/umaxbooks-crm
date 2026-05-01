'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Audit } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatDate, getClientFolder, getFileName } from '@/lib/utils'
import {
  FileText, ExternalLink, Globe, Star, MapPin, Phone, Mail, Clock,
  CheckCircle, XCircle, AlertCircle, BarChart2, Code2, Link2,
  Sparkles, Send, Bell, Save, Upload, RefreshCw, Image,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ComposeModal } from '@/components/email/ComposeModal'
import { EmailHistory } from '@/components/email/EmailHistory'

function extractStorageFolder(pdfUrl: string): string {
  const match = pdfUrl.match(/crm-files\/(.+?)\/[^/]+$/)
  return match ? match[1] : ''
}

interface AuditTabProps {
  leadId: string
  leadSlug: string
  userId: string
  userRole: string
  websiteUrl?: string
  businessName?: string
  city?: string
  leadEmail?: string
  leadName?: string
}

interface ScrapeResult {
  website: Record<string, any> | null
  gmb: Record<string, any> | null
  scrapedAt: string
  error?: string
}

// ── TAT helpers ──────────────────────────────────────────────────────────────
function getTatInfo(createdAt: string, uploadedAt: string | null, tatDays: number) {
  const start = new Date(createdAt).getTime()
  const deadline = start + tatDays * 86400000
  const now = Date.now()

  if (uploadedAt) {
    const done = new Date(uploadedAt).getTime()
    const diffMs = done - start
    const diffH = Math.round(diffMs / 3600000)
    const diffD = Math.floor(diffMs / 86400000)
    const onTime = done <= deadline
    const label = diffD > 0 ? `${diffD}d ${Math.round((diffMs % 86400000) / 3600000)}h` : `${diffH}h`
    return { status: 'done', onTime, label, pct: 100 }
  }

  const elapsed = now - start
  const pct = Math.min(100, Math.round((elapsed / (tatDays * 86400000)) * 100))
  const dueMs = deadline - now
  const overdue = dueMs < 0

  if (overdue) {
    const oDays = Math.ceil(Math.abs(dueMs) / 86400000)
    return { status: 'overdue', onTime: false, label: `${oDays}d overdue`, pct: 100 }
  }

  const dueHours = Math.round(dueMs / 3600000)
  const dueLabel = dueHours < 24
    ? `Due today ${new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `Due ${new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  return { status: 'pending', onTime: true, label: dueLabel, pct }
}

function StatusBadge({ status }: { status: 'uploaded' | 'in_progress' | 'not_started' }) {
  if (status === 'uploaded')
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-900/30 text-green-400 border border-green-800/40">Uploaded</span>
  if (status === 'in_progress')
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/40">In Progress</span>
  return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/40">Not Started</span>
}

function TatBar({ createdAt, uploadedAt, tatDays }: { createdAt: string; uploadedAt: string | null; tatDays: number }) {
  const { status, onTime, label, pct } = getTatInfo(createdAt, uploadedAt, tatDays)
  const barColor = status === 'done'
    ? onTime ? 'bg-green-500' : 'bg-orange-500'
    : status === 'overdue' ? 'bg-red-500' : 'bg-orange-400'
  const textColor = status === 'done'
    ? onTime ? 'text-green-400' : 'text-orange-400'
    : status === 'overdue' ? 'text-red-400' : 'text-orange-400'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">TAT: {tatDays} days</span>
        <span className={cn('font-medium', textColor)}>
          {status === 'done' ? (onTime ? `Delivered on time · ${label}` : `Delivered late · ${label}`) : label}
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────
function DropZone({ label, loading, onFile }: { label: string; loading: boolean; onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type === 'application/pdf') onFile(file)
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-xl px-6 py-8 flex flex-col items-center gap-2 cursor-pointer transition-colors',
        dragging ? 'border-orange-500 bg-orange-900/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/40'
      )}
    >
      {loading ? (
        <svg className="animate-spin h-6 w-6 text-orange-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      ) : (
        <Upload size={22} className="text-slate-500" />
      )}
      <p className="text-sm text-slate-400 text-center">{loading ? 'Uploading…' : label}</p>
      <p className="text-xs text-slate-600 text-center">Both agent and developer can upload</p>
      <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => {
        const f = e.target.files?.[0]
        if (f) onFile(f)
        e.target.value = ''
      }} />
    </div>
  )
}

// ── Scrape helpers (reused from old tab) ──────────────────────────────────────
const SOCIAL_PLATFORM_COLORS: Record<string, string> = {
  facebook: 'text-blue-400 bg-blue-900/20 hover:text-blue-300',
  instagram: 'text-pink-400 bg-pink-900/20 hover:text-pink-300',
  twitter: 'text-sky-400 bg-sky-900/20 hover:text-sky-300',
  youtube: 'text-red-400 bg-red-900/20 hover:text-red-300',
  linkedin: 'text-blue-300 bg-blue-900/20 hover:text-blue-200',
  tiktok: 'text-slate-300 bg-slate-700 hover:text-white',
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle size={14} className="text-green-400 flex-shrink-0" /> : <XCircle size={14} className="text-red-400 flex-shrink-0" />}
      <span className={ok ? 'text-slate-300' : 'text-slate-500'}>{label}</span>
    </div>
  )
}

function Tag({ children, color = 'slate' }: { children: React.ReactNode; color?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      color === 'green' && 'bg-green-900/30 text-green-300',
      color === 'red' && 'bg-red-900/30 text-red-300',
      color === 'orange' && 'bg-orange-900/30 text-orange-300',
      color === 'blue' && 'bg-blue-900/30 text-blue-300',
      color === 'slate' && 'bg-slate-700 text-slate-300',
    )}>{children}</span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function AuditTab({ leadId, leadSlug, userId, userRole, websiteUrl, businessName, city, leadEmail, leadName }: AuditTabProps) {
  const supabase = createClient()

  // Current audit (latest record for this lead)
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(true)

  // Scrape state
  const [scraping, setScraping] = useState(false)
  const [scrapeData, setScrapeData] = useState<ScrapeResult | null>(null)
  const [gmbSaved, setGmbSaved] = useState(false)

  // Agent notes
  const [agentNotes, setAgentNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  // File uploads
  const [uploadingShort, setUploadingShort] = useState(false)
  const [uploadingLong, setUploadingLong] = useState(false)

  // Developer notes
  const [devNotesShort, setDevNotesShort] = useState('')
  const [devNotesLong, setDevNotesLong] = useState('')
  const [savingDevNotesShort, setSavingDevNotesShort] = useState(false)
  const [savingDevNotesLong, setSavingDevNotesLong] = useState(false)

  // AI generate
  const [generating, setGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiScore, setAiScore] = useState<number | null>(null)

  // Compose email modal
  const [showComposeModal, setShowComposeModal] = useState(false)
  const [emailHistoryKey, setEmailHistoryKey]   = useState(0)

  const canEdit = userRole === 'admin' || userRole === 'agent' || userRole === 'sales_agent'
  const canUpload = userRole === 'admin' || userRole === 'agent' || userRole === 'sales_agent' || userRole === 'developer'
  const isDev = userRole === 'developer'

  useEffect(() => { fetchAudit() }, [leadId])

  async function fetchAudit() {
    setLoading(true)
    const { data } = await supabase
      .from('audits')
      .select(`*,
        created_by_profile:profiles!audits_created_by_fkey(full_name),
        short_uploader:profiles!audits_short_uploaded_by_fkey(full_name),
        long_uploader:profiles!audits_long_uploaded_by_fkey(full_name)
      `)
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setAudit(data as Audit)
      setAgentNotes(data.agent_notes || '')
      setDevNotesShort(data.developer_notes_short || '')
      setDevNotesLong(data.developer_notes_long || '')
    }
    setLoading(false)
  }

  async function ensureAudit(): Promise<string> {
    if (audit?.id) return audit.id
    const { data } = await supabase
      .from('audits')
      .insert({ lead_id: leadId, created_by: userId, tat_days: 2 })
      .select('id')
      .single()
    await fetchAudit()
    return data!.id
  }

  async function handleScrape() {
    setScraping(true)
    setScrapeData(null)
    setGmbSaved(false)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl, businessName, city }),
      })
      const data: ScrapeResult = await res.json()
      setScrapeData(data)
      if (data.gmb && !data.gmb.error) {
        const g = data.gmb
        const update: Record<string, any> = {}
        if (g.rating != null)     update.gmb_review_rating = g.rating
        if (g.reviewCount != null) update.number_of_reviews = g.reviewCount
        if (g.categories)         update.gmb_category = g.categories
        if (g.phone)              update.phone = g.phone
        if (g.address)            update.address = g.address
        if (g.mapsUrl)            update.gmb_url = g.mapsUrl
        if (Object.keys(update).length) {
          await supabase.from('leads').update(update).eq('id', leadId)
          setGmbSaved(true)
        }
      }
    } catch (e: any) {
      setScrapeData({ website: null, gmb: null, scrapedAt: new Date().toISOString(), error: e.message })
    } finally {
      setScraping(false)
    }
  }

  async function handleSaveNotes(notify: boolean) {
    setSavingNotes(true)
    setNotesSaved(false)
    try {
      const auditId = await ensureAudit()
      await supabase.from('audits').update({ agent_notes: agentNotes }).eq('id', auditId)

      if (notify) {
        // Notify all developers
        const { data: devs } = await supabase.from('profiles').select('id').eq('role', 'developer')
        if (devs?.length) {
          await supabase.from('notifications').insert(
            devs.map(d => ({
              user_id: d.id,
              lead_id: leadId,
              title: 'Audit Notes Updated',
              message: `Agent notes updated for ${businessName || 'a lead'}. Check the Audit tab for instructions.`,
              type: 'info',
            }))
          )
        }
        await supabase.from('activity_logs').insert({
          lead_id: leadId, user_id: userId,
          action: 'Audit Notes Saved',
          details: 'Agent notes saved and developers notified.',
        })
      }
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 3000)
      await fetchAudit()
    } finally {
      setSavingNotes(false)
    }
  }

  async function uploadFile(type: 'short' | 'long', file: File) {
    const setUploading = type === 'short' ? setUploadingShort : setUploadingLong
    setUploading(true)
    try {
      const auditId = await ensureAudit()
      const folder = getClientFolder(leadSlug)
      const version = `v${Date.now()}`
      const name = getFileName(type === 'short' ? 'audit-short' : 'audit-long', leadSlug, version, 'pdf')
      const path = `${folder}/audits/${name}`

      const { data: storageData, error: storageErr } = await supabase.storage
        .from('crm-files')
        .upload(path, file, { upsert: true })

      if (storageErr || !storageData) {
        console.error('Storage upload failed:', storageErr)
        return
      }

      const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(storageData.path)

      const update: Record<string, any> = {
        file_names: {
          ...(audit?.file_names || {}),
          [type]: file.name,
        },
      }
      const now = new Date().toISOString()
      if (type === 'short') {
        update.audit_short_pdf_url = urlData.publicUrl
        update.short_uploaded_by = userId
        update.short_file_size = file.size
        update.short_uploaded_at = now
      } else {
        update.audit_long_pdf_url = urlData.publicUrl
        update.long_uploaded_by = userId
        update.long_file_size = file.size
        update.long_uploaded_at = now
      }

      await supabase.from('audits').update(update).eq('id', auditId)

      await supabase.from('activity_logs').insert({
        lead_id: leadId, user_id: userId,
        action: type === 'short' ? 'Summary Audit Uploaded' : 'Detailed Audit Uploaded',
        details: file.name,
      })

      await fetchAudit()
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveDevNotes(type: 'short' | 'long') {
    const setSaving = type === 'short' ? setSavingDevNotesShort : setSavingDevNotesLong
    setSaving(true)
    try {
      const auditId = await ensureAudit()
      const col = type === 'short' ? 'developer_notes_short' : 'developer_notes_long'
      const val = type === 'short' ? devNotesShort : devNotesLong
      await supabase.from('audits').update({ [col]: val }).eq('id', auditId)
      await fetchAudit()
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateAudit() {
    setGenerating(true)
    setAiError(null)
    setAiScore(null)
    try {
      const res = await fetch('/api/generate-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, leadSlug, userId, websiteUrl, businessName, city }),
      })
      const data = await res.json()
      if (!res.ok) setAiError(data.error || 'Failed to generate audit')
      else { setAiScore(data.score); await fetchAudit() }
    } catch (e: any) {
      setAiError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const shortStatus: 'uploaded' | 'in_progress' | 'not_started' =
    audit?.audit_short_pdf_url ? 'uploaded' : audit ? 'in_progress' : 'not_started'
  const longStatus: 'uploaded' | 'in_progress' | 'not_started' =
    audit?.audit_long_pdf_url ? 'uploaded' : audit ? 'in_progress' : 'not_started'

  const w = scrapeData?.website
  const g = scrapeData?.gmb

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 text-sm gap-2">
        <svg className="animate-spin h-4 w-4 text-orange-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
        Loading audit…
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* ── Agent Notes for Developer ─────────────────────────────────────── */}
      {canEdit && (
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Agent Notes for Developer</p>
          <textarea
            value={agentNotes}
            onChange={e => setAgentNotes(e.target.value)}
            placeholder="Add instructions for the developer — focus areas, competitor info, client priorities…"
            rows={3}
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
          />
          <div className="flex items-center gap-2 mt-2.5">
            <Button size="sm" onClick={() => handleSaveNotes(true)} loading={savingNotes} className="bg-orange-500 hover:bg-orange-600 text-white border-0">
              <Bell size={13} /> Save & Notify Developer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => handleSaveNotes(false)} loading={savingNotes}>
              <Save size={13} /> Save Draft
            </Button>
            {notesSaved && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} /> Saved</span>}
          </div>
        </div>
      )}

      {/* Developer reads agent notes */}
      {isDev && audit?.agent_notes && (
        <div className="bg-slate-800/60 border border-orange-900/30 rounded-xl p-4">
          <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-2">Agent Notes for You</p>
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{audit.agent_notes}</p>
        </div>
      )}

      {/* ── AI Generate ───────────────────────────────────────────────────── */}
      {canEdit && (
        <div className="bg-gradient-to-r from-slate-800/80 to-orange-950/20 border border-orange-900/30 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                <Sparkles size={18} className="text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-100">Generate AI SEO Report</p>
                <p className="text-xs text-slate-400 mt-0.5">Claude AI scrapes the site, analyses SEO signals, and auto-generates + uploads both PDFs.</p>
                {aiScore !== null && !generating && (
                  <div className="flex items-center gap-1.5 mt-2"><CheckCircle size={13} className="text-green-400" /><span className="text-xs text-green-300 font-medium">Generated! Score: {aiScore}/100</span></div>
                )}
                {aiError && !generating && (
                  <div className="flex items-center gap-1.5 mt-2"><XCircle size={13} className="text-red-400" /><span className="text-xs text-red-300">{aiError}</span></div>
                )}
              </div>
            </div>
            <Button size="sm" onClick={handleGenerateAudit} loading={generating} disabled={generating || (!websiteUrl && !businessName)} className="flex-shrink-0 bg-orange-500 hover:bg-orange-600 text-white border-0">
              <Sparkles size={13} /> Generate Report
            </Button>
          </div>
          {generating && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400 bg-slate-900/40 rounded-lg px-3 py-2">
              <svg className="animate-spin h-3.5 w-3.5 text-orange-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Scraping website &amp; GMB, running Claude AI, generating PDFs… 20–40 seconds.
            </div>
          )}
        </div>
      )}

      {/* ── Summary Audit Report ─────────────────────────────────────────── */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-200">Summary Audit Report</span>
          </div>
          <StatusBadge status={shortStatus} />
        </div>

        <div className="px-4 pt-3 pb-1">
          {audit && <TatBar createdAt={audit.created_at} uploadedAt={audit.short_uploaded_at || null} tatDays={audit.tat_days || 2} />}
        </div>

        <div className="px-4 py-3 space-y-3">
          {audit?.audit_short_pdf_url ? (
            <>
              {/* File row */}
              <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-orange-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{audit.file_names?.short || 'Summary Report'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {audit.short_uploader ? `Uploaded by ${(audit.short_uploader as any).full_name}` : 'Uploaded'}
                    {audit.short_file_size ? ` · ${(audit.short_file_size / 1024).toFixed(0)} KB` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <a href={audit.audit_short_pdf_url} target="_blank" rel="noreferrer"
                    className="text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors">
                    View
                  </a>
                  {canEdit && (
                    <button onClick={() => setShowComposeModal(true)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/30 px-3 py-1.5 rounded-lg border border-emerald-800/40 transition-colors">
                      Send to Client
                    </button>
                  )}
                </div>
              </div>

              {/* SEO score if available */}
              {audit.score != null && (
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full border',
                    audit.score >= 70 ? 'text-green-400 bg-green-900/20 border-green-800/40'
                    : audit.score >= 50 ? 'text-orange-400 bg-orange-900/20 border-orange-800/40'
                    : 'text-red-400 bg-red-900/20 border-red-800/40')}>
                    SEO Score: {audit.score}/100
                  </span>
                </div>
              )}

              {/* Developer notes */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Developer Notes</p>
                {isDev || canEdit ? (
                  <div className="space-y-2">
                    <textarea
                      value={devNotesShort}
                      onChange={e => setDevNotesShort(e.target.value)}
                      placeholder={isDev ? 'Add your findings about this report…' : 'Developer notes will appear here…'}
                      readOnly={!isDev && !canEdit}
                      rows={2}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                    />
                    {(isDev || canEdit) && (
                      <Button size="sm" variant="ghost" onClick={() => handleSaveDevNotes('short')} loading={savingDevNotesShort}>
                        <Save size={12} /> Save Notes
                      </Button>
                    )}
                  </div>
                ) : audit.developer_notes_short ? (
                  <p className="text-sm text-slate-400 bg-slate-900/40 rounded-lg px-3 py-2 leading-relaxed">{audit.developer_notes_short}</p>
                ) : null}
              </div>
            </>
          ) : canUpload ? (
            <DropZone
              label="Drop summary audit PDF here, or click to upload"
              loading={uploadingShort}
              onFile={f => uploadFile('short', f)}
            />
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">Waiting for summary report upload.</p>
          )}
        </div>
      </div>

      {/* ── Detailed Audit Report ─────────────────────────────────────────── */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-200">Detailed Audit Report</span>
          </div>
          <StatusBadge status={longStatus} />
        </div>

        <div className="px-4 pt-3 pb-1">
          {audit && <TatBar createdAt={audit.created_at} uploadedAt={audit.long_uploaded_at || null} tatDays={audit.tat_days || 2} />}
        </div>

        <div className="px-4 py-3 space-y-3">
          {audit?.audit_long_pdf_url ? (
            <>
              <div className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 truncate">{audit.file_names?.long || 'Detailed Report'}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {audit.long_uploader ? `Uploaded by ${(audit.long_uploader as any).full_name}` : 'Uploaded'}
                    {audit.long_file_size ? ` · ${(audit.long_file_size / 1024).toFixed(0)} KB` : ''}
                  </p>
                </div>
                <a href={audit.audit_long_pdf_url} target="_blank" rel="noreferrer"
                  className="text-xs text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                  View
                </a>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Developer Notes</p>
                {isDev || canEdit ? (
                  <div className="space-y-2">
                    <textarea
                      value={devNotesLong}
                      onChange={e => setDevNotesLong(e.target.value)}
                      placeholder={isDev ? 'Add detailed findings, keyword gaps, technical issues…' : 'Developer notes will appear here…'}
                      rows={2}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                    />
                    {(isDev || canEdit) && (
                      <Button size="sm" variant="ghost" onClick={() => handleSaveDevNotes('long')} loading={savingDevNotesLong}>
                        <Save size={12} /> Save Notes
                      </Button>
                    )}
                  </div>
                ) : audit.developer_notes_long ? (
                  <p className="text-sm text-slate-400 bg-slate-900/40 rounded-lg px-3 py-2 leading-relaxed">{audit.developer_notes_long}</p>
                ) : null}
              </div>
            </>
          ) : canUpload ? (
            <DropZone
              label="Drop detailed audit PDF here, or click to upload"
              loading={uploadingLong}
              onFile={f => uploadFile('long', f)}
            />
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">Waiting for detailed report upload.</p>
          )}
        </div>
      </div>

      {/* ── Send to Client Modal ─────────────────────────────────────────── */}
      {/* Email History */}
      {(userRole === 'admin' || userRole === 'sales_agent' || userRole === 'agent') && (
        <div className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Mail size={13} /> Email History
          </p>
          <EmailHistory leadId={leadId} refreshKey={emailHistoryKey} />
        </div>
      )}

      {showComposeModal && (
        <ComposeModal
          leadId={leadId}
          leadEmail={leadEmail}
          leadName={leadName}
          businessName={businessName}
          auditPdfUrl={audit?.audit_short_pdf_url}
          auditPdfName={audit?.file_names?.short || 'summary-report.pdf'}
          storageFolder={audit?.audit_short_pdf_url ? extractStorageFolder(audit.audit_short_pdf_url) : undefined}
          userId={userId}
          onClose={() => setShowComposeModal(false)}
          onSent={() => setEmailHistoryKey(k => k + 1)}
        />
      )}
    </div>
  )
}
