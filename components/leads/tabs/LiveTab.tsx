'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LiveSite } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import { Globe, Calendar, Server, CheckCircle2, Edit2 } from 'lucide-react'

interface LiveTabProps {
  leadId: string
  userId: string
  userRole: string
}

export function LiveTab({ leadId, userId, userRole }: LiveTabProps) {
  const [liveSite, setLiveSite] = useState<LiveSite | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    final_url: '',
    go_live_date: '',
    hosting_provider: '',
    domain_status: '',
  })
  const supabase = createClient()

  useEffect(() => { fetchLiveSite() }, [leadId])

  async function fetchLiveSite() {
    const { data } = await supabase.from('live_sites').select('*').eq('lead_id', leadId).maybeSingle()
    if (data) {
      setLiveSite(data)
      setForm({
        final_url: data.final_url || '',
        go_live_date: data.go_live_date || '',
        hosting_provider: data.hosting_provider || '',
        domain_status: data.domain_status || '',
      })
    }
  }

  async function handleSave() {
    setLoading(true)
    const payload = {
      lead_id: leadId,
      final_url: form.final_url || null,
      go_live_date: form.go_live_date || null,
      hosting_provider: form.hosting_provider || null,
      domain_status: form.domain_status || null,
    }

    if (liveSite) {
      await supabase.from('live_sites').update(payload).eq('id', liveSite.id)
    } else {
      await supabase.from('live_sites').insert(payload)
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: liveSite ? 'Live Site Updated' : 'Live Site Created',
      details: form.final_url ? `Final URL: ${form.final_url}` : 'Live site details updated',
    })

    setShowModal(false)
    setLoading(false)
    fetchLiveSite()
  }

  const canEdit = userRole === 'admin' || userRole === 'developer'

  return (
    <div className="space-y-4">
      {liveSite ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-green-400" />
              <h3 className="font-semibold text-slate-100">Live Site</h3>
            </div>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => setShowModal(true)}>
                <Edit2 size={13} /> Edit
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {liveSite.final_url && (
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Final URL</p>
                <a href={liveSite.final_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300">
                  <Globe size={14} /> {liveSite.final_url}
                </a>
              </div>
            )}
            {liveSite.go_live_date && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Go-Live Date</p>
                <p className="text-sm text-slate-200 flex items-center gap-1.5">
                  <Calendar size={13} className="text-orange-400" />
                  {formatDate(liveSite.go_live_date)}
                </p>
              </div>
            )}
            {liveSite.hosting_provider && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Hosting Provider</p>
                <p className="text-sm text-slate-200 flex items-center gap-1.5">
                  <Server size={13} className="text-slate-400" />
                  {liveSite.hosting_provider}
                </p>
              </div>
            )}
            {liveSite.domain_status && (
              <div>
                <p className="text-xs text-slate-500 mb-1">Domain Status</p>
                <span className="text-xs bg-teal-900/30 text-teal-300 px-2.5 py-1 rounded-full">{liveSite.domain_status}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-slate-500 text-sm">
          Site not live yet.
          {canEdit && (
            <div className="mt-3">
              <Button size="sm" onClick={() => setShowModal(true)}>Add Live Site</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={liveSite ? 'Edit Live Site' : 'Add Live Site'}>
        <div className="space-y-4">
          <Input label="Final URL" type="url" placeholder="https://" value={form.final_url}
            onChange={(e) => setForm((f) => ({ ...f, final_url: e.target.value }))} />
          <Input label="Go-Live Date" type="date" value={form.go_live_date}
            onChange={(e) => setForm((f) => ({ ...f, go_live_date: e.target.value }))} />
          <Input label="Hosting Provider" placeholder="e.g. Cloudflare, GoDaddy" value={form.hosting_provider}
            onChange={(e) => setForm((f) => ({ ...f, hosting_provider: e.target.value }))} />
          <Input label="Domain Status" placeholder="e.g. Active, Pending Transfer" value={form.domain_status}
            onChange={(e) => setForm((f) => ({ ...f, domain_status: e.target.value }))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} loading={loading}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
