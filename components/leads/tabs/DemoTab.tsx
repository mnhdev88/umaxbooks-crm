'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Demo, Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { TextArea } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Plus, ExternalLink, Monitor, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { DevDemoTab } from '@/components/developer/DevDemoTab'
import { ensureHttps } from '@/lib/utils'

interface DemoTabProps {
  leadId: string
  leadSlug: string
  companyName: string
  userId: string
  userRole: string
  developers: Profile[]
}

const APPROVAL_BADGE = {
  pending:  { cls: 'bg-amber-900/40 text-amber-300 border-amber-700/50',  Icon: Clock,         label: 'Pending Approval' },
  approved: { cls: 'bg-green-900/40 text-green-300 border-green-700/50',  Icon: CheckCircle2,  label: 'Approved' },
  declined: { cls: 'bg-red-900/40 text-red-300 border-red-700/50',        Icon: XCircle,       label: 'Declined' },
}

export function DemoTab({ leadId, leadSlug, companyName, userId, userRole, developers }: DemoTabProps) {
  const [demos, setDemos] = useState<Demo[]>([])
  const [approvalMap, setApprovalMap] = useState<Record<string, any>>({})
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [declining, setDeclining] = useState<string | null>(null)
  const [declineReason, setDeclineReason] = useState('')
  const [actioning, setActioning] = useState<string | null>(null)
  const [form, setForm] = useState({ developer_id: '', temp_url: '', demo_version: '', upload_date: '' })
  const supabase = createClient()

  const isAdmin = userRole === 'admin'
  const isSalesAgent = userRole === 'sales_agent' || userRole === 'sales_manager'
  const isDeveloper = userRole === 'developer'

  useEffect(() => { fetchDemos(); fetchApprovals() }, [leadId])

  async function fetchDemos() {
    const { data } = await supabase
      .from('demos')
      .select('*, developer:profiles(full_name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setDemos(data as Demo[])
  }

  async function fetchApprovals() {
    const { data } = await supabase
      .from('project_approvals')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) {
      const map: Record<string, any> = {}
      for (const a of data) {
        if (a.demo_url && !map[a.demo_url]) map[a.demo_url] = a
      }
      setApprovalMap(map)
    }
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

    if (form.temp_url) {
      await fetch('/api/demo-status-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })
    }

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

  async function handleApprove(approval: any) {
    setActioning(approval.id)
    await supabase
      .from('project_approvals')
      .update({ status: 'approved', approved_by: userId, approved_at: new Date().toISOString() })
      .eq('id', approval.id)

    const { data: lead } = await supabase
      .from('leads')
      .select('assigned_agent_id, company_name')
      .eq('id', leadId)
      .single()

    if (lead?.assigned_agent_id) {
      await supabase.from('notifications').insert({
        user_id: lead.assigned_agent_id,
        lead_id: leadId,
        title: 'Demo Approved — Close the Deal',
        message: `${companyName} demo has been approved. Time to close!`,
        type: 'info',
      })
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Approved',
      details: 'Admin approved the demo.',
    })

    setActioning(null)
    fetchApprovals()
  }

  async function handleDecline(approval: any) {
    setActioning(approval.id)
    await supabase
      .from('project_approvals')
      .update({ status: 'declined', revision_notes: declineReason || null })
      .eq('id', approval.id)

    if (approval.developer_id) {
      await supabase.from('notifications').insert({
        user_id: approval.developer_id,
        lead_id: leadId,
        title: 'Demo Declined — Revision Required',
        message: declineReason
          ? `${companyName} demo was declined: ${declineReason.slice(0, 80)}`
          : `${companyName} demo was declined. Please revise and resubmit.`,
        type: 'info',
      })
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Declined',
      details: declineReason ? `Reason: ${declineReason}` : 'Demo declined by admin.',
    })

    setDeclining(null)
    setDeclineReason('')
    setActioning(null)
    fetchApprovals()
  }

  // Developer view — use dedicated DevDemoTab
  if (isDeveloper) {
    return (
      <DevDemoTab
        leadId={leadId}
        leadSlug={leadSlug}
        userId={userId}
        companyName={companyName}
      />
    )
  }

  // Sales agent: only show demos where the URL has been approved (or no approval = admin-uploaded)
  const visibleDemos = isSalesAgent
    ? demos.filter(d => {
        if (!d.temp_url) return true
        const approval = approvalMap[d.temp_url]
        return !approval || approval.status === 'approved'
      })
    : demos

  const devOptions = developers.map((d) => ({ value: d.id, label: d.full_name }))

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus size={14} /> Add Demo
          </Button>
        </div>
      )}

      {visibleDemos.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          {isSalesAgent ? 'No approved demos yet.' : 'No demos uploaded yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleDemos.map((demo) => {
            const approval = demo.temp_url ? approvalMap[demo.temp_url] : undefined
            const badge = approval ? APPROVAL_BADGE[approval.status as keyof typeof APPROVAL_BADGE] : null
            const isPendingApproval = approval?.status === 'pending'
            const isDecliningThis = declining === approval?.id

            return (
              <div key={demo.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor size={15} className="text-orange-400" />
                    <span className="text-sm font-semibold text-slate-200">
                      {demo.demo_version || 'Demo'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {badge && (
                      <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', badge.cls)}>
                        <badge.Icon size={10} /> {badge.label}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{formatDate(demo.created_at)}</span>
                  </div>
                </div>

                {demo.developer && (
                  <p className="text-xs text-slate-400">Developer: {demo.developer.full_name}</p>
                )}
                {demo.upload_date && (
                  <p className="text-xs text-slate-400">Upload Date: {formatDate(demo.upload_date)}</p>
                )}
                {demo.temp_url && (
                  <div className="flex items-center gap-1.5">
                    <a href={ensureHttps(demo.temp_url)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 truncate">
                      <ExternalLink size={13} className="flex-shrink-0" /> {demo.temp_url}
                    </a>
                    <CopyButton text={ensureHttps(demo.temp_url)} />
                  </div>
                )}

                {/* Decline reason visible to admin */}
                {isAdmin && approval?.status === 'declined' && approval?.revision_notes && (
                  <div className="bg-red-900/15 border border-red-700/30 rounded-lg px-3 py-2 mt-1">
                    <p className="text-xs font-semibold text-red-400 mb-0.5">Revision Notes</p>
                    <p className="text-xs text-slate-300">{approval.revision_notes}</p>
                  </div>
                )}

                {/* Admin inline approve / decline */}
                {isAdmin && isPendingApproval && (
                  <div className="pt-1 space-y-2">
                    {isDecliningThis ? (
                      <div className="space-y-2">
                        <TextArea
                          label="Reason for declining"
                          rows={2}
                          value={declineReason}
                          onChange={e => setDeclineReason(e.target.value)}
                          placeholder="Describe what needs to be fixed…"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleDecline(approval)}
                            loading={actioning === approval.id}
                            className="bg-red-600 hover:bg-red-500 text-white"
                          >
                            <XCircle size={13} /> Confirm Decline
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setDeclining(null); setDeclineReason('') }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(approval)}
                          loading={actioning === approval.id}
                          className="bg-green-600 hover:bg-green-500 text-white"
                        >
                          <CheckCircle2 size={13} /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeclining(approval.id)}
                          disabled={!!actioning}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        >
                          <XCircle size={13} /> Decline
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
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
