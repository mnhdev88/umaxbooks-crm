'use client'
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { renderSection } from '@/lib/emailSections'
import {
  X, Send, Save, Eye, Paperclip, Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, Link2, Unlink, Code, Clock, ChevronDown, Loader2, Trash2,
  FileText, Upload, FolderOpen, CheckCircle, AlertCircle,
  AlignLeft, AlignCenter, AlignRight, Quote, RemoveFormatting, Baseline, Highlighter,
} from 'lucide-react'

interface EmailProvider { id: string; name: string; provider: string; from_email: string; from_name: string; username: string | null }
interface EmailTemplate { id: string; name: string; subject: string; html_body: string }
interface Attachment { name: string; url: string }

interface DraftData {
  provider_id?: string
  to_email?: string
  cc?: string
  bcc?: string
  subject?: string
  html_body?: string
  attachments?: Attachment[]
}

interface Props {
  leadId: string
  leadEmail?: string
  /** Additional emails on file (leads.alt_emails) — offered as "To" choices. */
  altEmails?: { value: string; label?: string }[] | null
  leadName?: string
  businessName?: string
  businessType?: string
  city?: string
  auditPdfUrl?: string
  auditPdfName?: string
  storageFolder?: string
  userId: string
  onClose: () => void
  onSent?: () => void
  initialSubject?: string
  initialBody?: string
  initialDraft?: DraftData
}

export function ComposeModal({
  leadId, leadEmail = '', altEmails, leadName = '', businessName = '', businessType = '', city = '',
  auditPdfUrl, auditPdfName, storageFolder, userId, onClose, onSent,
  initialSubject, initialBody, initialDraft,
}: Props) {
  const supabase = createClient()

  // Agent profile for template placeholders
  const [agentName, setAgentName]   = useState('')
  const [agentEmail, setAgentEmail] = useState('')
  // Approved demo link for this lead → {{demo_url}} (blank when none approved)
  const [demoUrl, setDemoUrl]       = useState('')

  // Form state
  const [providers, setProviders]     = useState<EmailProvider[]>([])
  const [templates, setTemplates]     = useState<EmailTemplate[]>([])
  const [providerId, setProviderId]   = useState(initialDraft?.provider_id ?? '')
  const [to, setTo]                   = useState(initialDraft?.to_email ?? leadEmail ?? '')
  const [cc, setCc]                   = useState(initialDraft?.cc ?? '')
  const [bcc, setBcc]                 = useState(initialDraft?.bcc ?? '')
  const [subject, setSubject]         = useState(initialDraft?.subject ?? initialSubject ?? `Your SEO Audit Report — ${businessName ?? ''}`)
  const [htmlMode, setHtmlMode]       = useState(false)
  const [htmlBody, setHtmlBody]       = useState(initialDraft?.html_body ?? initialBody ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [showCcBcc, setShowCcBcc]     = useState(false)
  const [showFilePicker, setShowFilePicker] = useState(false)
  const [storageFiles, setStorageFiles]     = useState<Attachment[]>([])
  const [loadingFiles, setLoadingFiles]     = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending]         = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [result, setResult]           = useState<{ ok: boolean; msg: string } | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [htmlBodyVersion, setHtmlBodyVersion] = useState(0)

  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync loaded HTML into the contentEditable div synchronously before paint
  useLayoutEffect(() => {
    if (editorRef.current && !htmlMode) {
      editorRef.current.innerHTML = htmlBody
    }
  }, [htmlBodyVersion])

  // Boot
  useEffect(() => {
    loadProviders()
    loadTemplates()
    loadDemoUrl()
    if (initialDraft) {
      // Pre-filled from draft click — show CC/BCC if populated, set body version
      if (initialDraft.cc || initialDraft.bcc) setShowCcBcc(true)
      if (initialDraft.attachments?.length) setAttachments(initialDraft.attachments)
      if (initialDraft.html_body) setHtmlBodyVersion(v => v + 1)
      setDraftLoaded(true)
    } else if (initialBody) {
      setHtmlBody(initialBody)
      setHtmlBodyVersion(v => v + 1)
    } else {
      loadClientTemplate().then(hasTemplate => {
        if (!hasTemplate) loadDraft()
      })
    }
    if (auditPdfUrl) {
      const name = auditPdfName || auditPdfUrl.split('/').pop() || 'audit-report.pdf'
      setAttachments(prev => prev.length ? prev : [{ name, url: auditPdfUrl }])
    }
  }, [])

  async function loadProviders() {
    const [{ data }, { data: profile }] = await Promise.all([
      supabase.from('email_providers').select('*').eq('is_active', true).order('is_default', { ascending: false }),
      supabase.from('profiles').select('full_name, email').eq('id', userId).single(),
    ])
    setProviders(data || [])
    if (!initialDraft?.provider_id) {
      const def = (data || []).find((p: any) => p.is_default)
      if (def) setProviderId(def.id)
    }
    if (profile) {
      setAgentName(profile.full_name || '')
      setAgentEmail(profile.email || '')
    }
  }

  async function loadTemplates() {
    const { data } = await supabase.from('email_templates').select('*').order('name')
    setTemplates(data || [])
  }

  // Latest approved demo link for this lead — powers {{demo_url}} in templates.
  async function loadDemoUrl() {
    const { data } = await supabase
      .from('project_approvals')
      .select('demo_url')
      .eq('lead_id', leadId)
      .eq('status', 'approved')
      .not('demo_url', 'is', null)
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle()
    setDemoUrl(data?.demo_url || '')
  }

  async function loadDraft(): Promise<boolean> {
    const res = await fetch(`/api/email/draft?lead_id=${leadId}`)
    const { draft } = await res.json()
    if (draft) {
      if (draft.provider_id) setProviderId(draft.provider_id)
      if (draft.to_email) setTo(draft.to_email)
      if (draft.cc) { setCc(draft.cc); setShowCcBcc(true) }
      if (draft.bcc) { setBcc(draft.bcc); setShowCcBcc(true) }
      if (draft.subject) setSubject(draft.subject)
      if (draft.html_body) {
        setHtmlBody(draft.html_body)
        setHtmlBodyVersion(v => v + 1)
      }
      if (draft.attachments?.length) setAttachments(draft.attachments)
    }
    setDraftLoaded(true)
    return !!draft?.html_body
  }

  async function loadClientTemplate(): Promise<boolean> {
    const { data, error } = await supabase
      .from('content_library')
      .select('*')
      .eq('lead_id', leadId)
      .eq('type', 'email_template')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) console.warn('[ComposeModal] template query error:', error)

    const templateUrl = data?.file_url || data?.url
    if (!templateUrl) return false

    try {
      const res = await fetch(templateUrl, { cache: 'no-store' })
      if (!res.ok) return false
      const html = await res.text()
      if (html?.trim()) {
        setHtmlBody(html)
        setHtmlBodyVersion(v => v + 1)
        return true
      }
    } catch {
      // fall through to draft
    }
    return false
  }

  // Sync editor ↔ htmlBody state
  function onEditorInput() {
    if (editorRef.current) setHtmlBody(editorRef.current.innerHTML)
  }

  // Remember the caret/selection so toolbar controls that steal focus
  // (native <select>, colour pop-overs, prompt dialogs) can restore it.
  const savedRange = useRef<Range | null>(null)
  const saveSelection = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }, [])
  function restoreSelection() {
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    if (savedRange.current) sel.addRange(savedRange.current)
  }

  function switchToHtml() {
    if (editorRef.current) setHtmlBody(editorRef.current.innerHTML)
    setHtmlMode(true)
  }

  function switchToVisual() {
    setHtmlMode(false)
    setHtmlBodyVersion(v => v + 1)
  }

  // Toolbar commands — restore the last editor selection before running so the
  // command applies to the highlighted text even if a control stole focus.
  function cmd(command: string, value?: string) {
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand(command, false, value)
    onEditorInput()
    saveSelection()
  }

  function insertLink() {
    const url = prompt('Enter URL:')
    if (!url) return
    cmd('createLink', /^https?:\/\/|^mailto:/i.test(url) ? url : `https://${url}`)
  }

  // Template apply
  function applyTemplate(t: EmailTemplate) {
    const agencyName    = process.env.NEXT_PUBLIC_AGENCY_NAME    || 'Novelio Technologies'
    const agencyPhone   = process.env.NEXT_PUBLIC_AGENCY_PHONE   || ''
    const agencyWebsite = process.env.NEXT_PUBLIC_AGENCY_WEBSITE || 'noveliotech.com'

    const replacePlaceholders = (str: string) => {
      const pairs: [string, string][] = [
        ['{{client_name}}',    leadName      || 'there'],
        ['{{business_name}}',  businessName  || 'your business'],
        ['{{company_name}}',   businessName  || 'your business'],
        ['{{business_type}}',  businessType  || ''],
        ['{{city}}',           city          || ''],
        ['{{report_url}}',     auditPdfUrl   || ''],
        ['{{demo_url}}',       demoUrl       || ''],
        ['{{agent_name}}',     agentName     || agencyName],
        ['{{agent_email}}',    agentEmail    || ''],
        ['{{agent_phone}}',    agencyPhone],
        ['{{agency_name}}',    agencyName],
        ['{{agency_website}}', agencyWebsite],
        ['{{agent_whatsapp}}', process.env.NEXT_PUBLIC_AGENT_WHATSAPP || ''],
      ]
      // Resolve {{#demo_url}}/{{^demo_url}} blocks first so the demo link only
      // renders when an approved demo exists, then run the flat token replace.
      const withSections = renderSection(str, 'demo_url', !!demoUrl)
      return pairs.reduce((s, [key, val]) => s.split(key).join(val), withSections)
    }

    setHtmlBody(replacePlaceholders(t.html_body))
    setHtmlBodyVersion(v => v + 1)
    if (t.subject) setSubject(replacePlaceholders(t.subject))
  }

  // Storage file picker
  async function openFilePicker() {
    if (!storageFolder) return
    setShowFilePicker(true)
    setLoadingFiles(true)
    const res = await fetch(`/api/email/storage-files?folder=${encodeURIComponent(storageFolder)}`)
    const { files } = await res.json()
    setStorageFiles(files || [])
    setLoadingFiles(false)
  }

  function addStorageFile(f: Attachment) {
    if (!attachments.find(a => a.url === f.url)) setAttachments(prev => [...prev, f])
    setShowFilePicker(false)
  }

  // Upload from computer
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const path = `${storageFolder || `clients/tmp-${leadId}`}/${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from('crm-files').upload(path, file, { upsert: true })
    if (error) { alert(error.message); return }
    const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(path)
    setAttachments(prev => [...prev, { name: file.name, url: urlData.publicUrl }])
    e.target.value = ''
  }

  function removeAttachment(url: string) {
    setAttachments(prev => prev.filter(a => a.url !== url))
  }

  // Save draft
  async function saveDraft() {
    setSavingDraft(true)
    await fetch('/api/email/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, provider_id: providerId, to_email: to, cc, bcc, subject, html_body: htmlBody, attachments }),
    })
    setSavingDraft(false)
    setResult({ ok: true, msg: 'Draft saved' })
    setTimeout(() => setResult(null), 2000)
  }

  // Send
  async function send() {
    if (!providerId) { setResult({ ok: false, msg: 'Select an email provider' }); return }
    if (!to) { setResult({ ok: false, msg: 'Enter recipient email' }); return }
    if (!subject) { setResult({ ok: false, msg: 'Enter a subject' }); return }

    setSending(true)
    setResult(null)
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: leadId, provider_id: providerId,
        to_email: to, cc: cc || null, bcc: bcc || null,
        subject, html_body: htmlBody, attachments,
        scheduled_at: showSchedule && scheduledAt ? scheduledAt : null,
      }),
    })
    const data = await res.json()
    setSending(false)
    if (res.ok) {
      setResult({ ok: true, msg: data.scheduled ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}` : 'Email sent!' })
      setTimeout(() => { onSent?.(); onClose() }, 1500)
    } else {
      setResult({ ok: false, msg: data.error || 'Send failed' })
    }
  }

  // Escape to close + lock background scroll while the modal is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentProvider = providers.find(p => p.id === providerId)

  // Every email on file for this lead — primary first, then the alternates.
  const leadEmails = [
    ...(leadEmail ? [{ value: leadEmail, label: 'Primary' }] : []),
    ...(altEmails || []).filter(e => e.value?.trim()),
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-6 px-4 pb-6 overflow-y-auto"
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div role="dialog" aria-modal="true" aria-label="Compose Email" className="bg-[#0E0B24] border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-semibold text-base flex items-center gap-2">
              <Send className="w-4 h-4 text-orange-400" aria-hidden="true" /> Compose Email
            </h2>
            <button onClick={onClose} aria-label="Close" className="inline-flex items-center justify-center min-w-9 min-h-9 text-slate-400 hover:text-white rounded transition-colors">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <div className="p-5 space-y-4">

            {/* From */}
            <div className="flex gap-3">
              <span className="text-xs text-slate-500 w-16 shrink-0 text-right pt-2">From</span>
              <div className="flex-1 space-y-1.5">
                <select
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
                >
                  <option value="">— Select email provider —</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.provider === 'gmail' ? p.username : p.from_email})
                    </option>
                  ))}
                </select>
                {(agentName || agentEmail) && (
                  <p className="text-xs text-slate-500 px-1">
                    Sent by: <span className="text-slate-300">{agentName}</span>
                    {agentEmail && <span className="text-slate-400"> &lt;{agentEmail}&gt;</span>}
                  </p>
                )}
              </div>
            </div>

            {/* To */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-16 shrink-0 text-right">To</span>
              <div className="flex-1 flex items-center gap-2">
                <input
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                />
                <button
                  onClick={() => setShowCcBcc(v => !v)}
                  className="text-xs text-slate-400 hover:text-slate-200 whitespace-nowrap transition-colors"
                >
                  {showCcBcc ? 'Hide CC/BCC' : 'CC / BCC'}
                </button>
              </div>
            </div>

            {/* Pick between the lead's emails when more than one is on file */}
            {leadEmails.length > 1 && (
              <div className="flex items-center gap-3">
                <span className="w-16 shrink-0" />
                <div className="flex-1 flex flex-wrap gap-1.5">
                  {leadEmails.map(e => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => setTo(e.value)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        to.trim() === e.value
                          ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                          : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                      }`}
                    >
                      {e.label ? `${e.label}: ` : ''}{e.value}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* CC / BCC */}
            {showCcBcc && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0 text-right">CC</span>
                  <input
                    value={cc}
                    onChange={e => setCc(e.target.value)}
                    placeholder="cc1@example.com, cc2@example.com"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0 text-right">BCC</span>
                  <input
                    value={bcc}
                    onChange={e => setBcc(e.target.value)}
                    placeholder="bcc1@example.com, bcc2@example.com"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                  />
                </div>
              </>
            )}

            {/* Subject */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-16 shrink-0 text-right">Subject</span>
              <input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
              />
            </div>

            {/* Template picker */}
            {templates.length > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-16 shrink-0 text-right">Template</span>
                <select
                  defaultValue=""
                  onChange={e => {
                    const t = templates.find(t => t.id === e.target.value)
                    if (t) applyTemplate(t)
                  }}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500/50"
                >
                  <option value="">— Pick a template —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            {/* Rich text editor */}
            <div className="border border-white/10 rounded-xl overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center gap-1 px-3 py-2 bg-white/5 border-b border-white/10 flex-wrap">
                {!htmlMode && (
                  <>
                    {/* Paragraph format + font size */}
                    <ToolSelect
                      title="Text style"
                      onPick={v => cmd('formatBlock', v)}
                      options={FORMAT_BLOCKS}
                      placeholder="Style"
                    />
                    <ToolSelect
                      title="Font size"
                      onPick={v => cmd('fontSize', v)}
                      options={FONT_SIZES}
                      placeholder="Size"
                    />
                    <div className="w-px h-4 bg-white/20 mx-1" />

                    <ToolBtn onClick={() => cmd('bold')} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('italic')} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('underline')} title="Underline"><Underline className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('strikeThrough')} title="Strikethrough"><Strikethrough className="w-3.5 h-3.5" /></ToolBtn>

                    {/* Colours */}
                    <ColorMenu title="Text colour" icon={<Baseline className="w-3.5 h-3.5" />} colors={TEXT_COLORS} onPick={c => cmd('foreColor', c)} />
                    <ColorMenu title="Highlight" icon={<Highlighter className="w-3.5 h-3.5" />} colors={HIGHLIGHT_COLORS} onPick={c => cmd('hiliteColor', c)} />
                    <div className="w-px h-4 bg-white/20 mx-1" />

                    <ToolBtn onClick={() => cmd('insertUnorderedList')} title="Bullet list"><List className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('insertOrderedList')} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('formatBlock', 'blockquote')} title="Quote"><Quote className="w-3.5 h-3.5" /></ToolBtn>
                    <div className="w-px h-4 bg-white/20 mx-1" />

                    <ToolBtn onClick={() => cmd('justifyLeft')} title="Align left"><AlignLeft className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('justifyCenter')} title="Align center"><AlignCenter className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('justifyRight')} title="Align right"><AlignRight className="w-3.5 h-3.5" /></ToolBtn>
                    <div className="w-px h-4 bg-white/20 mx-1" />

                    <ToolBtn onClick={insertLink} title="Insert link"><Link2 className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('unlink')} title="Remove link"><Unlink className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('removeFormat')} title="Clear formatting"><RemoveFormatting className="w-3.5 h-3.5" /></ToolBtn>
                    <div className="w-px h-4 bg-white/20 mx-1" />
                  </>
                )}
                <button
                  onClick={htmlMode ? switchToVisual : switchToHtml}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ml-auto ${htmlMode ? 'bg-orange-500/20 text-orange-400' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                >
                  <Code className="w-3.5 h-3.5" /> {htmlMode ? 'Visual' : 'HTML'}
                </button>
              </div>

              {/* Editor area */}
              {htmlMode ? (
                <textarea
                  value={htmlBody}
                  onChange={e => setHtmlBody(e.target.value)}
                  placeholder="Paste or type HTML here…"
                  className="w-full bg-[#0E0B24] text-slate-300 text-sm font-mono px-4 py-3 focus:outline-none resize-none min-h-[260px]"
                  rows={14}
                />
              ) : (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  onInput={onEditorInput}
                  onKeyUp={saveSelection}
                  onMouseUp={saveSelection}
                  onBlur={saveSelection}
                  className="rte min-h-[260px] px-4 py-3 text-slate-200 text-sm focus:outline-none"
                  style={{ lineHeight: '1.7' }}
                  data-placeholder="Start typing or pick a template above…"
                />
              )}
            </div>

            {/* Attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">Attachments</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  {storageFolder && (
                    <button
                      onClick={openFilePicker}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" /> Pick from files
                    </button>
                  )}
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                </div>
              </div>

              {attachments.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No attachments</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {attachments.map(a => (
                    <div key={a.url} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300">
                      <FileText className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      <span className="max-w-[160px] truncate">{a.name}</span>
                      <button onClick={() => removeAttachment(a.url)} className="text-slate-500 hover:text-red-400 transition-colors ml-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Schedule toggle */}
            <div>
              <button
                onClick={() => setShowSchedule(v => !v)}
                className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors ${showSchedule ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}
              >
                <Clock className="w-3.5 h-3.5" />
                {showSchedule ? 'Sending now' : 'Schedule send'}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
              </button>

              {showSchedule && (
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500/50"
                  />
                  <span className="text-xs text-slate-400">Email will be saved — send manually from history when ready</span>
                </div>
              )}
            </div>

            {/* Result */}
            {result && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                {result.msg}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1 gap-3 flex-wrap">
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-lg transition-colors"
              >
                <Eye className="w-4 h-4" /> Preview
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={saveDraft}
                  disabled={savingDraft}
                  className="flex items-center gap-2 text-sm text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                >
                  {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Draft
                </button>
                <button
                  onClick={send}
                  disabled={sending || !providerId || !to}
                  className="flex items-center gap-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-5 py-2 rounded-lg transition-colors"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {sending ? 'Sending…' : showSchedule && scheduledAt ? 'Schedule' : 'Send Email'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Storage file picker overlay */}
      {showFilePicker && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-[#160E32] border border-white/10 rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-white font-medium text-sm">Pick from Uploaded Files</h3>
              <button onClick={() => setShowFilePicker(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 max-h-72 overflow-y-auto">
              {loadingFiles ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-orange-400" /></div>
              ) : storageFiles.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No files found</p>
              ) : (
                <div className="space-y-1">
                  {storageFiles.map(f => {
                    const already = attachments.some(a => a.url === f.url)
                    return (
                      <button
                        key={f.url}
                        onClick={() => !already && addStorageFile(f)}
                        disabled={already}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/10'}`}
                      >
                        <FileText className="w-4 h-4 text-orange-400 shrink-0" />
                        <span className="truncate text-slate-200">{f.name}</span>
                        {already && <span className="ml-auto text-xs text-slate-500">Added</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-100 border-b">
              <div>
                <p className="text-slate-800 font-medium text-sm">Preview</p>
                <p className="text-slate-500 text-xs">Subject: {subject}</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="text-slate-500 hover:text-slate-800"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto max-h-[70vh]">
              <iframe
                srcDoc={htmlBody || '<p style="font-family:sans-serif;padding:20px;color:#888">No content yet</p>'}
                className="w-full min-h-[400px] border-0"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// contentEditable execCommand values
const FORMAT_BLOCKS = [
  { label: 'Normal',     value: 'p'  },
  { label: 'Heading',    value: 'h2' },
  { label: 'Subheading', value: 'h3' },
]
const FONT_SIZES = [
  { label: 'Small',  value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large',  value: '5' },
  { label: 'Huge',   value: '6' },
]
// Email-friendly swatches (dark text for light backgrounds + brand accents)
const TEXT_COLORS = [
  '#0f172a', '#334155', '#64748b', '#ffffff',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899',
]
const HIGHLIGHT_COLORS = [
  'transparent', '#fef08a', '#fed7aa', '#bbf7d0',
  '#bfdbfe', '#e9d5ff', '#fecaca', '#e2e8f0',
]

function ToolBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
    >
      {children}
    </button>
  )
}

// Action-style dropdown: picking an option runs a command then resets to the label.
function ToolSelect({ title, placeholder, options, onPick }: {
  title: string
  placeholder: string
  options: { label: string; value: string }[]
  onPick: (value: string) => void
}) {
  return (
    <select
      title={title}
      value=""
      onChange={e => { if (e.target.value) onPick(e.target.value) }}
      className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs text-slate-300 focus:outline-none focus:border-orange-500/50 cursor-pointer hover:text-white"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value} className="bg-[#160E32]">{o.label}</option>)}
    </select>
  )
}

// Colour swatch pop-over. Uses onMouseDown/preventDefault so the editor selection
// (already saved on blur) is not disturbed before the command runs.
function ColorMenu({ title, icon, colors, onPick }: {
  title: string
  icon: React.ReactNode
  colors: string[]
  onPick: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
        title={title}
        className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors"
      >
        {icon}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onMouseDown={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 p-2 bg-[#160E32] border border-white/10 rounded-lg shadow-2xl grid grid-cols-4 gap-1.5">
            {colors.map(c => (
              <button
                key={c}
                onMouseDown={e => { e.preventDefault(); onPick(c); setOpen(false) }}
                title={c === 'transparent' ? 'None' : c}
                className="w-5 h-5 rounded border border-white/20 hover:scale-110 transition-transform"
                style={c === 'transparent'
                  ? { backgroundImage: 'linear-gradient(45deg,#64748b 25%,transparent 25%,transparent 75%,#64748b 75%),linear-gradient(45deg,#64748b 25%,transparent 25%,transparent 75%,#64748b 75%)', backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px' }
                  : { background: c }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
