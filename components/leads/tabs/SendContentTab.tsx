'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ContentItem, Lead } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import {
  FileText, Globe, Link2, Plus, X, Send, Mail, MessageCircle,
  Clock, CheckCircle, Upload, Trash2,
} from 'lucide-react'

interface SendContentTabProps {
  lead: Lead
  userId: string
  userRole: string
}

type Channel = 'whatsapp' | 'email' | 'both'

const TYPE_STYLES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pdf:  { label: 'PDF',  color: 'text-orange-500', icon: <FileText size={11} /> },
  blog: { label: 'BLOG', color: 'text-purple-400', icon: <Globe size={11} /> },
  link: { label: 'LINK', color: 'text-emerald-400', icon: <Link2 size={11} /> },
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

  // Add content modal
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<'pdf' | 'blog' | 'link'>('blog')
  const [addTitle, setAddTitle] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addUrl, setAddUrl] = useState('')
  const [addFile, setAddFile] = useState<File | null>(null)
  const [addGlobal, setAddGlobal] = useState(true)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const canEdit = userRole === 'admin' || userRole === 'sales_agent'

  useEffect(() => { fetchItems() }, [lead.id])

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

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleAddContent() {
    if (!addTitle.trim()) return
    setSaving(true)
    try {
      let fileUrl: string | undefined

      if (addType === 'pdf' && addFile) {
        const path = `content-library/${Date.now()}_${addFile.name}`
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
        url: addType !== 'pdf' ? addUrl.trim() || null : fileUrl || null,
        file_url: fileUrl || null,
        lead_id: addGlobal ? null : lead.id,
        created_by: userId,
      })

      setAddTitle(''); setAddDesc(''); setAddUrl(''); setAddFile(null)
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
    } finally {
      setSending(false)
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
                  'relative rounded-xl border p-3.5 cursor-pointer transition-all select-none',
                  isSelected
                    ? 'border-orange-500 bg-orange-950/20 shadow-[0_0_0_1px] shadow-orange-500/30'
                    : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={cn('text-xs font-bold flex items-center gap-1 mb-1', color)}>
                      {icon} {label}
                    </span>
                    <p className="text-sm font-semibold text-slate-100 leading-snug">{item.title}</p>
                    {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                    {!item.description && (item.url || item.file_url) && (
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
            )
          })}
        </div>

        {canEdit && (
          <button
            onClick={() => setShowAdd(true)}
            className="mt-3 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 border border-dashed border-slate-700 hover:border-slate-500 rounded-xl px-4 py-2.5 w-full justify-center transition-colors"
          >
            <Plus size={14} /> Upload new PDF / blog link
          </button>
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
            <p className="text-xs text-slate-500 mb-1.5">Message / caption <span className="text-slate-600">(optional)</span></p>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={`Hi ${lead.name?.split(' ')[0] || 'there'}, sharing some useful resources for ${lead.company_name}…`}
              rows={3}
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

      {/* ── Add Content Modal ─────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-100">Add to Content Library</p>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>

            {/* Type */}
            <div className="flex gap-2">
              {(['pdf', 'blog', 'link'] as const).map(t => (
                <button key={t} onClick={() => setAddType(t)}
                  className={cn('flex-1 py-1.5 rounded-lg text-xs font-semibold border uppercase tracking-wide transition-all',
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

            {/* Scope */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={addGlobal} onChange={e => setAddGlobal(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-orange-500 focus:ring-orange-500" />
              <span className="text-xs text-slate-400">Add to global library (visible for all leads)</span>
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAddContent} loading={saving} disabled={!addTitle.trim()}>
                <Plus size={13} /> Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
