'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ContentItem, Lead } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import {
  FileText, Globe, Link2, Plus, X, Send, Mail, MessageCircle,
  Clock, CheckCircle, Upload, Trash2, Sparkles, Copy, Check, Eye, ImageIcon,
  MailOpen, MailCheck, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'

interface SendContentTabProps {
  lead: Lead
  userId: string
  userRole: string
}

interface EmailTrackingRow {
  id: string
  to_email: string
  subject: string | null
  first_opened_at: string | null
  last_opened_at: string | null
  opened_count: number
  sent_at: string
}

type Channel = 'whatsapp' | 'email' | 'both'

const TYPE_STYLES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pdf:   { label: 'PDF',   color: 'text-orange-500', icon: <FileText size={11} /> },
  blog:  { label: 'BLOG',  color: 'text-purple-400', icon: <Globe size={11} /> },
  link:  { label: 'LINK',  color: 'text-emerald-400', icon: <Link2 size={11} /> },
  image: { label: 'IMAGE', color: 'text-sky-400',     icon: <ImageIcon size={11} /> },
}

export function SendContentTab({ lead, userId, userRole }: SendContentTabProps) {
  const supabase = createClient()

  const [items, setItems] = useState<ContentItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [message, setMessage] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [emailError, setEmailError] = useState('')

  // Add content modal
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<'pdf' | 'blog' | 'link' | 'image'>('blog')
  const [addTitle, setAddTitle] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addFile, setAddFile] = useState<File | null>(null)
  const [addPreviewUrl, setAddPreviewUrl] = useState<string | null>(null)
  const [addGlobal, setAddGlobal] = useState(true)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Email template (per-client HTML)
  const [emailTemplate, setEmailTemplate] = useState<ContentItem | null>(null)
  const [htmlCopied, setHtmlCopied] = useState(false)
  const [uploadingTemplate, setUploadingTemplate] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [templateHtml, setTemplateHtml] = useState<string | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const htmlFileRef = useRef<HTMLInputElement>(null)

  // Email tracking
  const [emailLogs, setEmailLogs] = useState<EmailTrackingRow[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [refreshingLogs, setRefreshingLogs] = useState(false)

  const canEdit = userRole === 'admin' || userRole === 'sales_agent'
  const canUploadTemplate = canEdit || userRole === 'developer'

  useEffect(() => { fetchItems(); fetchEmailTemplate(); fetchEmailLogs() }, [lead.id])

  async function fetchItems() {
    // Global items (lead_id IS NULL) + lead-specific items
    const { data } = await supabase
      .from('content_library')
      .select('*')
      .or(`lead_id.is.null,lead_id.eq.${lead.id}`)
      .order('created_at', { ascending: false })
    const base = (data as ContentItem[]) || []

    // Auto-inject lead-specific items from audit/demo
    const auto: ContentItem[] = []

    // Audit summary PDF
    const { data: audit } = await supabase
      .from('audits')
      .select('audit_short_pdf_url')
      .eq('lead_id', lead.id)
      .not('audit_short_pdf_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (audit?.audit_short_pdf_url) {
      auto.push({
        id: '__audit_short__',
        type: 'pdf',
        title: `Audit Summary — ${lead.company_name}`,
        description: 'Personalised report',
        url: audit.audit_short_pdf_url,
        created_at: '',
      })
    }

    // Demo temp URL
    const { data: demo } = await supabase
      .from('demos')
      .select('temp_url')
      .eq('lead_id', lead.id)
      .not('temp_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (demo?.temp_url) {
      auto.push({
        id: '__demo__',
        type: 'link',
        title: 'Demo website preview',
        description: 'Temp URL for this lead',
        url: demo.temp_url,
        created_at: '',
      })
    }

    setItems([...auto, ...base])
  }

  async function fetchEmailLogs(showLoader = false) {
    if (showLoader) setRefreshingLogs(true)
    const { data } = await supabase
      .from('email_tracking')
      .select('id, to_email, subject, first_opened_at, last_opened_at, opened_count, sent_at')
      .eq('lead_id', lead.id)
      .order('sent_at', { ascending: false })
      .limit(20)
    setEmailLogs((data as EmailTrackingRow[]) || [])
    if (showLoader) setRefreshingLogs(false)
  }

  async function fetchEmailTemplate() {
    const { data } = await supabase
      .from('content_library')
      .select('*')
      .eq('lead_id', lead.id)
      .eq('type', 'email_template')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setEmailTemplate(data as ContentItem | null)
  }

  async function handleHtmlUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingTemplate(true)
    try {
      const path = `email-templates/${lead.id}_${Date.now()}.html`
      const { data: up, error: upErr } = await supabase.storage.from('crm-files').upload(path, file, { upsert: true })
      if (upErr || !up) { alert('Storage upload failed: ' + (upErr?.message || 'unknown')); return }
      const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(up.path)
      const publicUrl = urlData.publicUrl

      // Remove previous template for this lead if any
      if (emailTemplate) {
        await supabase.from('content_library').delete().eq('id', emailTemplate.id)
      }

      const { error: insertErr } = await supabase.from('content_library').insert({
        type: 'email_template',
        title: file.name.replace(/\.[^.]+$/, ''),
        url: publicUrl,
        file_url: publicUrl,
        lead_id: lead.id,
        created_by: userId,
      })
      if (insertErr) { alert('DB insert failed: ' + insertErr.message); return }

      await fetchEmailTemplate()
    } finally {
      setUploadingTemplate(false)
      e.target.value = ''
    }
  }

  async function handleCopyHtml() {
    if (!emailTemplate?.file_url && !emailTemplate?.url) return
    const url = (emailTemplate.file_url || emailTemplate.url) as string
    const res = await fetch(url)
    const html = await res.text()
    await navigator.clipboard.writeText(html)
    setHtmlCopied(true)
    setTimeout(() => setHtmlCopied(false), 2000)
  }

  async function handleLoadTemplateAsBody() {
    if (!emailTemplate?.file_url && !emailTemplate?.url) return
    setLoadingTemplate(true)
    try {
      const url = (emailTemplate.file_url || emailTemplate.url) as string
      const res = await fetch(`/api/fetch-template?url=${encodeURIComponent(url)}`)
      const { html } = await res.json()
      if (html) {
        setTemplateHtml(html)
        setChannel('email')
      }
    } finally {
      setLoadingTemplate(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAddContent() {
    if (!addTitle.trim()) return
    if ((addType === 'pdf' || addType === 'image') && !addFile) return
    setSaving(true)
    try {
      let fileUrl: string | undefined

      if ((addType === 'pdf' || addType === 'image') && addFile) {
        const folder = addType === 'image' ? 'content-library/images' : 'content-library'
        const path = `${folder}/${Date.now()}_${addFile.name}`
        const { data: up } = await supabase.storage.from('crm-files').upload(path, addFile, { upsert: true })
        if (up) {
          const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(up.path)
          fileUrl = urlData.publicUrl
        }
      }

      await supabase.from('content_library').insert({
        type: addType,
        title: addTitle.trim(),
        description: addDesc.trim() || null,
        url: (addType === 'pdf' || addType === 'image') ? fileUrl || null : addUrl.trim() || null,
        file_url: fileUrl || null,
        lead_id: addType === 'image' ? lead.id : (addGlobal ? null : lead.id),
        created_by: userId,
      })

      setAddTitle(''); setAddDesc(''); setAddUrl(''); setAddFile(null)
      setAddPreviewUrl(null)
      setShowAdd(false)
      fetchItems()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await supabase.from('content_library').delete().eq('id', id)
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
    fetchItems()
  }

  function buildWhatsAppUrl() {
    const links = items
      .filter(i => selected.has(i.id))
      .map(i => i.url || i.file_url)
      .filter(Boolean)
      .join('\n')
    const text = [message.trim(), links].filter(Boolean).join('\n\n')
    const phone = (lead.phone || '').replace(/\D/g, '')
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
  }

  async function handleSend() {
    if (selected.size === 0) return
    setSending(true)
    setResult(null)

    try {
      const selectedItems = items.filter(i => selected.has(i.id))
      const links = selectedItems.map(i => `• ${i.title}: ${i.url || i.file_url || ''}`).join('\n')

      let ok = true
      let msg = ''

      if (channel === 'whatsapp' || channel === 'both') {
        // Open WhatsApp in new tab
        window.open(buildWhatsAppUrl(), '_blank')
        msg = 'WhatsApp opened'
      }

      if (channel === 'email' || channel === 'both') {
        if (!lead.email) {
          setResult({ ok: false, msg: 'No email address on this lead.' })
          setSending(false)
          return
        }
        const res = await fetch('/api/send-content-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: lead.email,
            clientName: lead.name,
            businessName: lead.company_name,
            message: message.trim(),
            links: selectedItems.map(i => ({ title: i.title, url: i.url || i.file_url })),
            htmlBody: templateHtml || undefined,
            leadId: lead.id,
            userId,
          }),
        })
        const data = await res.json()
        if (!res.ok) { ok = false; msg = data.error || 'Email failed' }
        else msg = channel === 'both' ? 'WhatsApp opened + email sent' : 'Email sent'
      }

      // Log the send
      const nonAutoIds = Array.from(selected).filter(id => !id.startsWith('__'))
      await supabase.from('content_sends').insert({
        lead_id: lead.id,
        user_id: userId,
        content_ids: nonAutoIds,
        channel,
        message: message.trim() || null,
        scheduled_at: scheduledAt || null,
        sent_at: scheduledAt ? null : new Date().toISOString(),
      })
      await supabase.from('activity_logs').insert({
        lead_id: lead.id,
        user_id: userId,
        action: 'Content Sent',
        details: `Sent via ${channel}: ${selectedItems.map(i => i.title).join(', ')}`,
      })

      setResult({ ok, msg: msg || 'Sent successfully' })
      setSelected(new Set())
      setTemplateHtml(null)
      if (channel === 'email' || channel === 'both') {
        fetchEmailLogs()
        setShowLogs(true)
      }
    } finally {
      setSending(false)
    }
  }

  async function generateColdEmail() {
    setGenerating(true)
    setEmailError('')
    try {
      const res  = await fetch('/api/generate-cold-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead }),
      })
      const data = await res.json()
      if (data.email) {
        setMessage(data.email)
      } else {
        setEmailError(data.error || 'Generation failed — no email returned')
      }
    } catch (e: any) {
      setEmailError(e.message || 'Network error')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSchedule() {
    if (!scheduledAt || selected.size === 0) return
    const nonAutoIds = Array.from(selected).filter(id => !id.startsWith('__'))
    await supabase.from('content_sends').insert({
      lead_id: lead.id,
      user_id: userId,
      content_ids: nonAutoIds,
      channel,
      message: message.trim() || null,
      scheduled_at: scheduledAt,
      sent_at: null,
    })
    await supabase.from('activity_logs').insert({
      lead_id: lead.id,
      user_id: userId,
      action: 'Content Scheduled',
      details: `Scheduled for ${new Date(scheduledAt).toLocaleString()}: ${items.filter(i => selected.has(i.id)).map(i => i.title).join(', ')}`,
    })
    setResult({ ok: true, msg: `Scheduled for ${new Date(scheduledAt).toLocaleString()}` })
    setSelected(new Set())
    setScheduledAt('')
  }

  return (
    <div className="space-y-6">

      {/* ── Content Library ──────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Content Library</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map(item => {
            const isSelected = selected.has(item.id)
            const { label, color, icon } = TYPE_STYLES[item.type] || TYPE_STYLES.link
            const isAuto = item.id.startsWith('__')
            return (
              <div
                key={item.id}
                onClick={() => toggleSelect(item.id)}
                className={cn(
                  'relative rounded-xl border cursor-pointer transition-all select-none overflow-hidden',
                  isSelected
                    ? 'border-orange-500 bg-orange-950/20 shadow-[0_0_0_1px] shadow-orange-500/30'
                    : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                )}
              >
                {item.type === 'image' && (item.file_url || item.url) && (
                  <div className="w-full h-28 bg-slate-700/40 overflow-hidden">
                    <img
                      src={(item.file_url || item.url) as string}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className={cn('text-xs font-bold flex items-center gap-1 mb-1', color)}>
                        {icon} {label}
                      </span>
                      <p className="text-sm font-semibold text-slate-100 leading-snug">{item.title}</p>
                      {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                      {!item.description && item.type !== 'image' && (item.url || item.file_url) && (
                        <p className="text-xs text-slate-600 mt-0.5 truncate max-w-[200px]">{item.url || item.file_url}</p>
                      )}
                    </div>
                    {!isAuto && canEdit && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(item.id) }}
                        className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {canEdit && (
          <button
            onClick={() => setShowAdd(true)}
            className="mt-3 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 border border-dashed border-slate-700 hover:border-slate-500 rounded-xl px-4 py-2.5 w-full justify-center transition-colors"
          >
            <Plus size={14} /> Upload PDF / image or add link
          </button>
        )}
      </div>

      {/* ── Client Email Template ────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Client Email Template</p>

        {emailTemplate ? (
          <div className="bg-slate-800/40 border border-slate-700 rounded-xl overflow-hidden">
            {/* Scaled preview */}
            <div className="relative border-b border-slate-700 bg-white h-44 overflow-hidden">
              <iframe
                src={(emailTemplate.file_url || emailTemplate.url) as string}
                sandbox="allow-same-origin"
                className="absolute top-0 left-0 w-[167%] h-[167%] pointer-events-none"
                style={{ transform: 'scale(0.6)', transformOrigin: 'top left' }}
                title="Email Template Preview"
              />
            </div>

            {/* Actions bar */}
            <div className="px-3 py-2.5 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-slate-400 truncate">{emailTemplate.title}</p>
              <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                <button
                  onClick={() => setShowPreview(true)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                >
                  <Eye size={11} /> Preview
                </button>
                <button
                  onClick={handleCopyHtml}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-orange-400 px-2 py-1 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                >
                  {htmlCopied ? <><Check size={11} className="text-green-400" /> Copied!</> : <><Copy size={11} /> Copy HTML</>}
                </button>
                <button
                  onClick={handleLoadTemplateAsBody}
                  disabled={loadingTemplate}
                  className={cn(
                    'flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors',
                    templateHtml
                      ? 'bg-green-900/30 text-green-400 border border-green-700/40'
                      : 'bg-orange-900/20 text-orange-400 hover:text-orange-300 hover:bg-orange-900/30 border border-orange-800/40'
                  )}
                >
                  <Mail size={11} />
                  {loadingTemplate ? 'Loading…' : templateHtml ? 'Template Active' : 'Use as Email Body'}
                </button>
                {canUploadTemplate && (
                  <button
                    onClick={() => htmlFileRef.current?.click()}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg hover:bg-slate-700/50 transition-colors"
                  >
                    <Upload size={11} /> Replace
                  </button>
                )}
              </div>
            </div>
            {templateHtml && (
              <div className="px-3 pb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">Email body loaded — will be sent as-is</p>
                  <button onClick={() => setTemplateHtml(null)} className="text-slate-500 hover:text-red-400 transition-colors">
                    <X size={12} />
                  </button>
                </div>
                <textarea
                  value={templateHtml}
                  onChange={e => setTemplateHtml(e.target.value)}
                  rows={6}
                  className="w-full bg-slate-900/60 border border-green-800/40 rounded-lg px-3 py-2 text-xs text-slate-400 font-mono focus:outline-none focus:border-green-500 resize-none"
                />
              </div>
            )}
          </div>
        ) : canUploadTemplate ? (
          <button
            onClick={() => htmlFileRef.current?.click()}
            disabled={uploadingTemplate}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 border border-dashed border-slate-700 hover:border-slate-500 rounded-xl px-4 py-3 w-full justify-center transition-colors disabled:opacity-50"
          >
            <Upload size={14} />
            {uploadingTemplate ? 'Uploading…' : 'Upload HTML Email Template'}
          </button>
        ) : (
          <p className="text-xs text-slate-600 text-center py-4">No email template uploaded yet.</p>
        )}

        <input
          ref={htmlFileRef}
          type="file"
          accept=".html,.htm"
          className="hidden"
          onChange={handleHtmlUpload}
        />
      </div>

      {/* Full-screen preview modal */}
      {showPreview && emailTemplate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={() => setShowPreview(false)}>
          <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-200">{emailTemplate.title}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyHtml}
                className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-orange-400 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
              >
                {htmlCopied ? <><Check size={11} className="text-green-400" /> Copied!</> : <><Copy size={11} /> Copy HTML</>}
              </button>
              <button onClick={() => setShowPreview(false)} className="text-slate-400 hover:text-white p-1">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 bg-white overflow-auto" onClick={e => e.stopPropagation()}>
            <iframe
              src={(emailTemplate.file_url || emailTemplate.url) as string}
              sandbox="allow-same-origin"
              className="w-full h-full min-h-screen"
              title="Email Template Full Preview"
            />
          </div>
        </div>
      )}

      {/* ── AI Cold Email Generator ──────────────────────────────────────── */}
      <div className="bg-slate-800/40 border border-slate-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-300">AI Cold Email Generator</p>
            <p className="text-xs text-slate-500 mt-0.5">Generate a personalized outreach email based on this lead's pain points</p>
          </div>
          <Button size="sm" onClick={generateColdEmail} loading={generating}>
            <Sparkles size={11} /> Generate
          </Button>
        </div>
        {emailError && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">{emailError}</p>
        )}
        {message.length > 0 && (
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={8}
            className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-orange-500 resize-none"
          />
        )}
      </div>

      {selected.size === 0 && (
        <p className="text-xs text-slate-500 text-center">Select one or more items above to send.</p>
      )}

      {/* ── Send Via ─────────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Send Via</p>
            <div className="flex gap-2">
              {(['whatsapp', 'email', 'both'] as Channel[]).map(ch => (
                <button
                  key={ch}
                  onClick={() => setChannel(ch)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border transition-all',
                    channel === ch
                      ? 'border-orange-500 text-orange-400 bg-orange-900/20'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  )}
                >
                  {ch === 'whatsapp' && <MessageCircle size={14} />}
                  {ch === 'email' && <Mail size={14} />}
                  {ch === 'both' && <Send size={14} />}
                  {ch.charAt(0).toUpperCase() + ch.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Message / caption <span className="text-slate-600">(optional — or use AI generator above)</span></p>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={`Hi ${lead.name?.split(' ')[0] || 'there'}, sharing some useful resources for ${lead.company_name}…`}
              rows={message.length > 200 ? 8 : 3}
              className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-1.5">Schedule send <span className="text-slate-600">(optional)</span></p>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                className="flex-1 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 [color-scheme:dark]"
              />
              <Button variant="ghost" size="sm" onClick={handleSchedule} disabled={!scheduledAt}>
                <Clock size={13} /> Schedule
              </Button>
            </div>
          </div>

          {result && (
            <div className={cn('flex items-center gap-2 text-sm rounded-lg px-3 py-2.5',
              result.ok ? 'bg-green-900/30 text-green-300 border border-green-800/40' : 'bg-red-900/30 text-red-300 border border-red-800/40')}>
              <CheckCircle size={14} />
              {result.msg}
            </div>
          )}

          <Button
            onClick={handleSend}
            loading={sending}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white border-0 py-2.5 text-sm font-semibold"
          >
            <Send size={14} /> Send Now
          </Button>
        </div>
      )}

      {/* ── Email Open Tracking ──────────────────────────────────────────── */}
      {emailLogs.length > 0 && (
        <div className="border border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowLogs(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/60 hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MailOpen size={14} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-300">Email Open Tracking</span>
              <span className="text-xs text-slate-500">({emailLogs.length} sent)</span>
              {emailLogs.some(l => l.first_opened_at) && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800/40">
                  {emailLogs.filter(l => l.first_opened_at).length} opened
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={e => { e.stopPropagation(); fetchEmailLogs(true) }}
                className="text-slate-500 hover:text-slate-300 transition-colors p-1"
                title="Refresh"
              >
                <RefreshCw size={12} className={refreshingLogs ? 'animate-spin' : ''} />
              </button>
              {showLogs ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
            </div>
          </button>

          {showLogs && (
            <div className="divide-y divide-slate-800">
              {emailLogs.map(log => {
                const opened = !!log.first_opened_at
                return (
                  <div key={log.id} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-300 font-medium truncate">{log.subject || '—'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        To: {log.to_email} · Sent {new Date(log.sent_at).toLocaleString()}
                      </p>
                      {opened && (
                        <p className="text-[11px] text-green-400 mt-0.5">
                          First opened {new Date(log.first_opened_at!).toLocaleString()}
                          {log.opened_count > 1 && ` · ${log.opened_count} opens total`}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 mt-0.5">
                      {opened ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-green-400">
                          <MailCheck size={13} /> Opened
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-slate-500">
                          <Mail size={13} /> Not opened
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Add Content Modal ─────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => { setShowAdd(false); setAddPreviewUrl(null) }}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-100">Add to Content Library</p>
              <button onClick={() => { setShowAdd(false); setAddPreviewUrl(null) }} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>

            {/* Type tabs */}
            <div className="grid grid-cols-4 gap-1.5">
              {(['pdf', 'blog', 'link', 'image'] as const).map(t => (
                <button key={t} onClick={() => { setAddType(t); setAddFile(null); setAddPreviewUrl(null) }}
                  className={cn('py-1.5 rounded-lg text-xs font-semibold border uppercase tracking-wide transition-all',
                    addType === t ? 'border-orange-500 text-orange-400 bg-orange-900/20' : 'border-slate-700 text-slate-500 hover:border-slate-500')}>
                  {t}
                </button>
              ))}
            </div>

            <input
              placeholder="Title *"
              value={addTitle}
              onChange={e => setAddTitle(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />

            {addType === 'image' ? (
              <>
                {/* Image drop zone */}
                <div
                  onClick={() => fileRef.current?.click()}
                  className={cn(
                    'border-2 border-dashed rounded-xl cursor-pointer transition-colors overflow-hidden',
                    addFile ? 'border-sky-500/50' : 'border-slate-700 hover:border-slate-500'
                  )}
                >
                  {addPreviewUrl ? (
                    <div className="relative">
                      <img src={addPreviewUrl} alt="preview" className="w-full max-h-48 object-contain bg-slate-800" />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-1.5">
                        <p className="text-xs text-slate-300 truncate">{addFile?.name}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-6 flex flex-col items-center gap-2">
                      <ImageIcon size={24} className="text-slate-500" />
                      <p className="text-xs text-slate-400 text-center">
                        Click to upload image<br />
                        <span className="text-slate-600">PNG, JPG, GIF, WebP, SVG, AVIF, HEIC…</span>
                      </p>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,.heic,.heif,.avif"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0] || null
                    setAddFile(file)
                    if (file) {
                      if (!addTitle.trim()) setAddTitle(file.name.replace(/\.[^.]+$/, ''))
                      setAddPreviewUrl(URL.createObjectURL(file))
                    } else {
                      setAddPreviewUrl(null)
                    }
                  }}
                />
                {/* Notes */}
                <textarea
                  placeholder="Notes (optional) — e.g. 'before redesign screenshot', 'logo variation'…"
                  value={addDesc}
                  onChange={e => setAddDesc(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
                />
              </>
            ) : (
              <>
                <input
                  placeholder="Short description (optional)"
                  value={addDesc}
                  onChange={e => setAddDesc(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
                />
                {addType === 'pdf' ? (
                  <div
                    onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-slate-500 rounded-xl px-4 py-5 flex flex-col items-center gap-2 cursor-pointer"
                  >
                    <Upload size={20} className="text-slate-500" />
                    <p className="text-xs text-slate-400">{addFile ? addFile.name : 'Click to upload PDF'}</p>
                    <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => setAddFile(e.target.files?.[0] || null)} />
                  </div>
                ) : (
                  <input
                    placeholder={addType === 'blog' ? 'Blog URL' : 'Link URL'}
                    value={addUrl}
                    onChange={e => setAddUrl(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
                  />
                )}
                {/* Scope (not shown for image — always lead-specific) */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={addGlobal} onChange={e => setAddGlobal(e.target.checked)}
                    className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500" />
                  <span className="text-xs text-slate-400">Add to global library (visible for all leads)</span>
                </label>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setAddPreviewUrl(null) }}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleAddContent}
                loading={saving}
                disabled={!addTitle.trim() || ((addType === 'pdf' || addType === 'image') && !addFile)}
              >
                <Plus size={13} /> Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
