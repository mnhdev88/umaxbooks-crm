'use client'
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  X, Send, Save, Eye, Paperclip, Bold, Italic, Underline,
  List, Link2, Code, Clock, ChevronDown, Loader2, Trash2,
  FileText, Upload, FolderOpen, CheckCircle, AlertCircle,
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
  leadId, leadEmail = '', leadName = '', businessName = '', businessType = '', city = '',
  auditPdfUrl, auditPdfName, storageFolder, userId, onClose, onSent,
  initialSubject, initialBody, initialDraft,
}: Props) {
  const supabase = createClient()

  // Agent profile for template placeholders
  const [agentName, setAgentName]   = useState('')
  const [agentEmail, setAgentEmail] = useState('')

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

  function switchToHtml() {
    if (editorRef.current) setHtmlBody(editorRef.current.innerHTML)
    setHtmlMode(true)
  }

  function switchToVisual() {
    setHtmlMode(false)
    setHtmlBodyVersion(v => v + 1)
  }

  // Toolbar commands
  function cmd(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    onEditorInput()
  }

  function insertLink() {
    const url = prompt('Enter URL:')
    if (url) cmd('createLink', url)
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
        ['{{agent_name}}',     agentName     || agencyName],
        ['{{agent_email}}',    agentEmail    || ''],
        ['{{agent_phone}}',    agencyPhone],
        ['{{agency_name}}',    agencyName],
        ['{{agency_website}}', agencyWebsite],
        ['{{agent_whatsapp}}', process.env.NEXT_PUBLIC_AGENT_WHATSAPP || ''],
      ]
      return pairs.reduce((s, [key, val]) => s.split(key).join(val), str)
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

  const currentProvider = providers.find(p => p.id === providerId)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-6 px-4 pb-6 overflow-y-auto">
        <div className="bg-[#0E0B24] border border-white/10 rounded-2xl w-full max-w-3xl shadow-2xl">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h2 className="text-white font-semibold text-base flex items-center gap-2">
              <Send className="w-4 h-4 text-orange-400" /> Compose Email
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded transition-colors">
              <X className="w-5 h-5" />
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

            {/* CC / BCC */}
            {showCcBcc && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0 text-right">CC</span>
                  <input
                    value={cc}
                    onChange={e => setCc(e.target.value)}
                    placeholder="cc@example.com"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-16 shrink-0 text-right">BCC</span>
                  <input
                    value={bcc}
                    onChange={e => setBcc(e.target.value)}
                    placeholder="bcc@example.com"
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
                    <ToolBtn onClick={() => cmd('bold')} title="Bold"><Bold className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('italic')} title="Italic"><Italic className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={() => cmd('underline')} title="Underline"><Underline className="w-3.5 h-3.5" /></ToolBtn>
                    <div className="w-px h-4 bg-white/20 mx-1" />
                    <ToolBtn onClick={() => cmd('insertUnorderedList')} title="Bullet list"><List className="w-3.5 h-3.5" /></ToolBtn>
                    <ToolBtn onClick={insertLink} title="Insert link"><Link2 className="w-3.5 h-3.5" /></ToolBtn>
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
                  className="min-h-[260px] px-4 py-3 text-slate-200 text-sm focus:outline-none"
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
