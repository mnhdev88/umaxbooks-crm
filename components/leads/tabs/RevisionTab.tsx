'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Revision } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { formatDate, getClientFolder, getFileName } from '@/lib/utils'
import { Plus, Image, ExternalLink } from 'lucide-react'

interface RevisionTabProps {
  leadId: string
  leadSlug: string
  userId: string
  userRole: string
}

const VERSION_OPTIONS = [
  { value: 'v1', label: 'v1' },
  { value: 'v2', label: 'v2' },
  { value: 'v3', label: 'v3' },
]

export function RevisionTab({ leadId, leadSlug, userId, userRole }: RevisionTabProps) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [ownerPhotoFile, setOwnerPhotoFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    phone: '',
    email: '',
    custom_notes: '',
    version_label: 'v1',
  })
  const supabase = createClient()

  useEffect(() => { fetchRevisions() }, [leadId])

  async function fetchRevisions() {
    const { data } = await supabase
      .from('revisions')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setRevisions(data as Revision[])
  }

  async function handleSave() {
    setLoading(true)
    const folder = `${getClientFolder(leadSlug)}/assets`
    const photoUrls: string[] = []

    for (const file of photoFiles) {
      const name = getFileName('client-photo', leadSlug, form.version_label, file.name.split('.').pop() || 'jpg')
      const { data } = await supabase.storage.from('crm-files').upload(`${folder}/${name}`, file, { upsert: true })
      if (data) {
        const { data: url } = supabase.storage.from('crm-files').getPublicUrl(data.path)
        photoUrls.push(url.publicUrl)
      }
    }

    let ownerPhotoUrl: string | undefined
    if (ownerPhotoFile) {
      const name = getFileName('owner-photo', leadSlug, form.version_label, ownerPhotoFile.name.split('.').pop() || 'jpg')
      const { data } = await supabase.storage.from('crm-files').upload(`${folder}/${name}`, ownerPhotoFile, { upsert: true })
      if (data) {
        const { data: url } = supabase.storage.from('crm-files').getPublicUrl(data.path)
        ownerPhotoUrl = url.publicUrl
      }
    }

    await supabase.from('revisions').insert({
      lead_id: leadId,
      created_by: userId,
      phone: form.phone || null,
      email: form.email || null,
      custom_notes: form.custom_notes || null,
      version_label: form.version_label,
      client_photos_urls: photoUrls,
      owner_photo_url: ownerPhotoUrl || null,
    })

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Revision Info Submitted',
      details: `Revision ${form.version_label} info collected`,
    })

    setPhotoFiles([])
    setOwnerPhotoFile(null)
    setForm({ phone: '', email: '', custom_notes: '', version_label: 'v1' })
    setShowModal(false)
    setLoading(false)
    fetchRevisions()
  }

  const canEdit = userRole === 'admin' || userRole === 'sales_agent'

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Add Revision Info
          </Button>
        </div>
      )}

      {revisions.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No revision info collected yet.</div>
      ) : (
        <div className="space-y-3">
          {revisions.map((rev) => (
            <div key={rev.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold bg-orange-500/20 text-orange-300 px-2.5 py-0.5 rounded-full">
                  {rev.version_label.toUpperCase()}
                </span>
                <span className="text-xs text-slate-500">{formatDate(rev.created_at)}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {rev.phone && <div><span className="text-slate-500">Phone:</span> <span className="text-slate-200">{rev.phone}</span></div>}
                {rev.email && <div><span className="text-slate-500">Email:</span> <span className="text-slate-200">{rev.email}</span></div>}
              </div>

              {rev.custom_notes && (
                <div className="bg-slate-700/50 rounded-lg p-3 text-sm text-slate-300">{rev.custom_notes}</div>
              )}

              {rev.owner_photo_url && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Owner Photo</p>
                  <img src={rev.owner_photo_url} alt="Owner" className="w-16 h-16 rounded-lg object-cover border border-slate-600" />
                </div>
              )}

              {rev.client_photos_urls.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-2">Client Photos ({rev.client_photos_urls.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {rev.client_photos_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt={`Photo ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-slate-600 hover:border-orange-500 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Revision Info" size="lg">
        <div className="space-y-4">
          <Select label="Version" options={VERSION_OPTIONS} value={form.version_label}
            onChange={(e) => setForm((f) => ({ ...f, version_label: e.target.value }))} />

          <div className="grid grid-cols-2 gap-4">
            <Input label="Client Phone" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input label="Client Email" type="email" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>

          <TextArea label="Custom Notes" value={form.custom_notes} rows={4}
            onChange={(e) => setForm((f) => ({ ...f, custom_notes: e.target.value }))}
            placeholder="Any specific requests or notes for the developer..." />

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1.5">Client Photos</label>
            <input type="file" accept="image/*" multiple onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
              className="w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 cursor-pointer" />
            {photoFiles.length > 0 && <p className="text-xs text-slate-500 mt-1">{photoFiles.length} file(s) selected</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide block mb-1.5">Owner Photo</label>
            <input type="file" accept="image/*" onChange={(e) => setOwnerPhotoFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-700 file:text-slate-200 hover:file:bg-slate-600 cursor-pointer" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
