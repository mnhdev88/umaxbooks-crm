'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Demo, Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import { Plus, ExternalLink, Monitor } from 'lucide-react'

interface DemoTabProps {
  leadId: string
  userId: string
  userRole: string
  developers: Profile[]
}

export function DemoTab({ leadId, userId, userRole, developers }: DemoTabProps) {
  const [demos, setDemos] = useState<Demo[]>([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ developer_id: '', temp_url: '', demo_version: '', upload_date: '' })
  const supabase = createClient()

  useEffect(() => { fetchDemos() }, [leadId])

  async function fetchDemos() {
    const { data } = await supabase
      .from('demos')
      .select('*, developer:profiles(full_name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setDemos(data as Demo[])
  }

  async function handleSave() {
    setLoading(true)
    await supabase.from('demos').insert({
      lead_id: leadId,
      developer_id: form.developer_id || null,
      temp_url: form.temp_url || null,
      demo_version: form.demo_version || null,
      upload_date: form.upload_date || null,
    })

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Uploaded',
      details: `Demo ${form.demo_version || ''} uploaded${form.temp_url ? ' — ' + form.temp_url : ''}`,
    })

    setForm({ developer_id: '', temp_url: '', demo_version: '', upload_date: '' })
    setShowModal(false)
    setLoading(false)
    fetchDemos()
  }

  const canEdit = userRole === 'admin' || userRole === 'developer'
  const devOptions = developers.map((d) => ({ value: d.id, label: d.full_name }))

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Add Demo
          </Button>
        </div>
      )}

      {demos.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">No demos uploaded yet.</div>
      ) : (
        <div className="space-y-3">
          {demos.map((demo) => (
            <div key={demo.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor size={15} className="text-orange-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    {demo.demo_version || 'Demo'}
                  </span>
                </div>
                <span className="text-xs text-slate-500">{formatDate(demo.created_at)}</span>
              </div>
              {demo.developer && (
                <p className="text-xs text-slate-400">Developer: {demo.developer.full_name}</p>
              )}
              {demo.upload_date && (
                <p className="text-xs text-slate-400">Upload Date: {formatDate(demo.upload_date)}</p>
              )}
              {demo.temp_url && (
                <a href={demo.temp_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
                  <ExternalLink size={13} /> {demo.temp_url}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Demo">
        <div className="space-y-4">
          <Select label="Assigned Developer" options={devOptions} placeholder="— Select developer —"
            value={form.developer_id} onChange={(e) => setForm((f) => ({ ...f, developer_id: e.target.value }))} />
          <Input label="Demo Version" placeholder="e.g. v1.0" value={form.demo_version}
            onChange={(e) => setForm((f) => ({ ...f, demo_version: e.target.value }))} />
          <Input label="Temp URL" type="url" placeholder="https://" value={form.temp_url}
            onChange={(e) => setForm((f) => ({ ...f, temp_url: e.target.value }))} />
          <Input label="Upload Date" type="date" value={form.upload_date}
            onChange={(e) => setForm((f) => ({ ...f, upload_date: e.target.value }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
