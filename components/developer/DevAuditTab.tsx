'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Audit } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { FileText, ExternalLink, Upload, Save, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DevAuditTabProps {
  leadId: string
  leadSlug: string
  userId: string
  websiteUrl?: string
  businessName?: string
  city?: string
}

export function DevAuditTab({ leadId, leadSlug, userId, websiteUrl, businessName, city }: DevAuditTabProps) {
  const supabase = createClient()
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(true)
  const [devNotesShort, setDevNotesShort] = useState('')
  const [devNotesLong, setDevNotesLong] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [uploadingShort, setUploadingShort] = useState(false)
  const [uploadingLong, setUploadingLong] = useState(false)
  const shortRef = useRef<HTMLInputElement>(null)
  const longRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchAudit() }, [leadId])

  async function fetchAudit() {
    setLoading(true)
    const { data } = await supabase
      .from('audits')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (data) {
      setAudit(data as Audit)
      setDevNotesShort(data.developer_notes_short || '')
      setDevNotesLong(data.developer_notes_long || '')
    }
    setLoading(false)
  }

  async function saveNotes() {
    if (!audit) return
    setSavingNotes(true)
    await supabase.from('audits').update({
      developer_notes_short: devNotesShort,
      developer_notes_long: devNotesLong,
    }).eq('id', audit.id)
    setSavingNotes(false)
  }

  async function uploadFile(file: File, type: 'short' | 'long') {
    if (!audit) return
    const setter = type === 'short' ? setUploadingShort : setUploadingLong
    setter(true)
    const folder = `${leadSlug}/audits`
    const ext = file.name.split('.').pop()
    const fileName = `${type}_audit_${Date.now()}.${ext}`
    const { data: upload, error } = await supabase.storage
      .from('crm-files')
      .upload(`${folder}/${fileName}`, file, { upsert: true })
    if (!error) {
      const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(`${folder}/${fileName}`)
      const field = type === 'short' ? 'audit_short_pdf_url' : 'audit_long_pdf_url'
      const notesField = type === 'short' ? 'developer_notes_short' : 'developer_notes_long'
      const uploadedField = type === 'short' ? 'short_uploaded_at' : 'long_uploaded_at'
      const uploaderField = type === 'short' ? 'short_uploaded_by' : 'long_uploaded_by'
      const updates: any = {
        [field]: urlData.publicUrl,
        [uploadedField]: new Date().toISOString(),
        [uploaderField]: userId,
      }
      await supabase.from('audits').update(updates).eq('id', audit.id)
      await supabase.from('activity_logs').insert({
        lead_id: leadId,
        user_id: userId,
        action: type === 'short' ? 'Summary Audit Uploaded' : 'Detailed Audit Uploaded',
        details: `Uploaded ${fileName}`,
      })
      fetchAudit()
    }
    setter(false)
  }

  async function notifyAgent() {
    if (!audit) return
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Developer Notification',
      details: 'Developer notified agent: audit files are ready for review.',
    })
    await supabase.from('notifications').insert({
      user_id: audit.created_by,
      lead_id: leadId,
      title: 'Audit Ready',
      message: `Developer has uploaded audit files for ${businessName || 'the lead'}.`,
      type: 'success',
    }).select()
    alert('Agent has been notified.')
  }

  if (loading) return <div className="text-center py-10 text-slate-500 text-sm">Loading...</div>

  if (!audit) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        No audit request found for this lead. The agent needs to create an audit request first.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary Audit Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-slate-100">Summary Audit</p>
            <p className="text-xs text-slate-500">Short PDF overview for the client</p>
          </div>
          {audit.audit_short_pdf_url ? (
            <span className="text-xs px-2.5 py-1 bg-green-900/30 text-green-300 rounded-full">Uploaded</span>
          ) : (
            <span className="text-xs px-2.5 py-1 bg-amber-900/30 text-amber-300 rounded-full">Pending</span>
          )}
        </div>

        {audit.audit_short_pdf_url && (
          <div className="mb-4 bg-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <p className="text-xs text-slate-400 truncate flex-1 mr-3">{audit.audit_short_pdf_url}</p>
            <a href={audit.audit_short_pdf_url} target="_blank" rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex-shrink-0">
              <ExternalLink size={13} />
            </a>
          </div>
        )}

        <div className="space-y-3">
          <textarea
            value={devNotesShort}
            onChange={e => setDevNotesShort(e.target.value)}
            placeholder="Developer notes for summary audit..."
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
          />
          <div className="flex gap-2">
            <input ref={shortRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
              onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0], 'short')} />
            <Button size="sm" variant="secondary" onClick={() => shortRef.current?.click()} loading={uploadingShort}>
              <Upload size={13} /> Upload PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Detailed Audit Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-slate-100">Detailed Audit</p>
            <p className="text-xs text-slate-500">Full technical audit document</p>
          </div>
          {audit.audit_long_pdf_url ? (
            <span className="text-xs px-2.5 py-1 bg-green-900/30 text-green-300 rounded-full">Uploaded</span>
          ) : (
            <span className="text-xs px-2.5 py-1 bg-amber-900/30 text-amber-300 rounded-full">Pending</span>
          )}
        </div>

        {audit.audit_long_pdf_url && (
          <div className="mb-4 bg-slate-800 rounded-lg px-3 py-2 flex items-center justify-between">
            <p className="text-xs text-slate-400 truncate flex-1 mr-3">{audit.audit_long_pdf_url}</p>
            <a href={audit.audit_long_pdf_url} target="_blank" rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 flex-shrink-0">
              <ExternalLink size={13} />
            </a>
          </div>
        )}

        <div className="space-y-3">
          <textarea
            value={devNotesLong}
            onChange={e => setDevNotesLong(e.target.value)}
            placeholder="Developer notes for detailed audit..."
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
          />
          <div className="flex gap-2">
            <input ref={longRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
              onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0], 'long')} />
            <Button size="sm" variant="secondary" onClick={() => longRef.current?.click()} loading={uploadingLong}>
              <Upload size={13} /> Upload PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button size="sm" variant="secondary" onClick={saveNotes} loading={savingNotes}>
          <Save size={13} /> Save Notes
        </Button>
        <Button size="sm" onClick={notifyAgent}>
          <Bell size={13} /> Upload & Notify Agent
        </Button>
      </div>

      {/* Audit meta */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-500">
        <p>Audit requested: {formatDate(audit.created_at)}</p>
        {audit.tat_days && <p>TAT: {audit.tat_days} day{audit.tat_days > 1 ? 's' : ''}</p>}
        {audit.short_uploaded_at && <p>Summary uploaded: {formatDate(audit.short_uploaded_at)}</p>}
        {audit.long_uploaded_at && <p>Detailed uploaded: {(audit as any).long_uploaded_at ? formatDate((audit as any).long_uploaded_at) : ''}</p>}
      </div>
    </div>
  )
}
