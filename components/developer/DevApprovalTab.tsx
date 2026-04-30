'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DemoApproval, Profile } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { CheckSquare, Square, CheckCircle, XCircle, Clock, User, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DevApprovalTabProps {
  leadId: string
  userId: string
  userRole: string
  agents: Profile[]
}

const CHECKLIST_ITEMS = [
  { key: 'design_matches_brief',    label: 'Design matches client brief' },
  { key: 'mobile_responsive',       label: 'Mobile responsive on all screen sizes' },
  { key: 'pages_load_correctly',    label: 'All pages load without errors' },
  { key: 'contact_forms_work',      label: 'Contact forms submit correctly' },
  { key: 'images_optimised',        label: 'Images optimized (WebP, compressed)' },
  { key: 'seo_metadata_added',      label: 'SEO meta tags & schema added' },
  { key: 'analytics_installed',     label: 'Analytics & tracking installed' },
  { key: 'cross_browser_tested',    label: 'Cross-browser tested (Chrome/Safari/Firefox)' },
]

export function DevApprovalTab({ leadId, userId, userRole, agents }: DevApprovalTabProps) {
  const supabase = createClient()
  const [approval, setApproval] = useState<DemoApproval | null>(null)
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [auditorId, setAuditorId] = useState('')
  const [auditorNotes, setAuditorNotes] = useState('')
  const [deadline, setDeadline] = useState('')
  const [resultNotes, setResultNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [actioning, setActioning] = useState<'approved' | 'rejected' | null>(null)

  const isAdmin = userRole === 'admin'
  const canApprove = userRole === 'admin' || userId === approval?.auditor_id

  useEffect(() => { fetchApproval() }, [leadId])

  async function fetchApproval() {
    const { data } = await supabase
      .from('demo_approvals')
      .select('*, auditor:profiles!demo_approvals_auditor_id_fkey(full_name)')
      .eq('lead_id', leadId)
      .limit(1)
      .maybeSingle()
    if (data) {
      setApproval(data as DemoApproval)
      setChecklist(data.checklist || {})
      setAuditorId(data.auditor_id || '')
      setAuditorNotes(data.auditor_notes || '')
      setDeadline(data.deadline || '')
      setResultNotes(data.result_notes || '')
    }
  }

  function toggleItem(key: string) {
    if (approval?.status !== 'pending' && approval?.status) return
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const checkedCount = Object.values(checklist).filter(Boolean).length

  async function saveChecklist() {
    setSaving(true)
    const payload = {
      checklist,
      auditor_id: auditorId || null,
      auditor_notes: auditorNotes,
      deadline: deadline || null,
      updated_at: new Date().toISOString(),
    }
    if (approval?.id) {
      await supabase.from('demo_approvals').update(payload).eq('id', approval.id)
    } else {
      await supabase.from('demo_approvals').insert({ lead_id: leadId, ...payload, status: 'pending' })
    }
    setSaving(false)
    fetchApproval()
  }

  async function handleDecision(decision: 'approved' | 'rejected') {
    setActioning(decision)
    const payload = {
      status: decision,
      result_notes: resultNotes,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    if (approval?.id) {
      await supabase.from('demo_approvals').update(payload).eq('id', approval.id)
    } else {
      await supabase.from('demo_approvals').insert({ lead_id: leadId, ...payload, checklist, auditor_id: userId })
    }
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: decision === 'approved' ? 'Demo Approved' : 'Demo Rejected',
      details: resultNotes || `Demo ${decision} by auditor.`,
    })
    setActioning(null)
    fetchApproval()
  }

  const isPending = !approval || approval.status === 'pending'
  const isApproved = approval?.status === 'approved'
  const isRejected = approval?.status === 'rejected'

  return (
    <div className="space-y-5">

      {/* Result banner */}
      {!isPending && (
        <div className={cn(
          'flex items-start gap-3 rounded-xl px-4 py-3.5',
          isApproved ? 'bg-green-900/25 border border-green-700/40' : 'bg-red-900/25 border border-red-700/40'
        )}>
          {isApproved ? <CheckCircle size={18} className="text-green-400 flex-shrink-0 mt-0.5" /> : <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />}
          <div>
            <p className={cn('text-sm font-bold', isApproved ? 'text-green-300' : 'text-red-300')}>
              Demo {isApproved ? 'Approved' : 'Rejected'}
            </p>
            {approval?.result_notes && <p className="text-xs text-slate-400 mt-0.5">{approval.result_notes}</p>}
            {approval?.reviewed_at && <p className="text-xs text-slate-500 mt-1">Reviewed: {formatDate(approval.reviewed_at)}</p>}
          </div>
        </div>
      )}

      {/* Checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">QA Checklist</p>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
            checkedCount === CHECKLIST_ITEMS.length ? 'bg-green-900/30 text-green-300' : 'bg-slate-800 text-slate-400')}>
            {checkedCount}/{CHECKLIST_ITEMS.length}
          </span>
        </div>
        <div className="space-y-2">
          {CHECKLIST_ITEMS.map(item => {
            const checked = checklist[item.key] || false
            return (
              <button
                key={item.key}
                onClick={() => toggleItem(item.key)}
                disabled={!isPending}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  checked ? 'bg-green-900/15 border border-green-700/25' : 'bg-slate-800 border border-slate-700',
                  isPending ? 'hover:border-slate-600 cursor-pointer' : 'cursor-default opacity-80'
                )}
              >
                {checked
                  ? <CheckSquare size={15} className="text-green-400 flex-shrink-0" />
                  : <Square size={15} className="text-slate-600 flex-shrink-0" />}
                <span className={cn('text-sm', checked ? 'text-slate-200' : 'text-slate-400')}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Assignment & deadline */}
      {isAdmin && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Assign Auditor</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Auditor</label>
              <select
                value={auditorId}
                onChange={e => setAuditorId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500 cursor-pointer"
              >
                <option value="">— Select —</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1.5 block">Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>
          {deadline && new Date(deadline) < new Date() && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
              <Clock size={11} /> Deadline has passed
            </div>
          )}
        </div>
      )}

      {/* Auditor notes */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Auditor Notes</p>
        <textarea
          value={auditorNotes}
          onChange={e => setAuditorNotes(e.target.value)}
          disabled={!isPending}
          placeholder="Notes from the auditor reviewing this demo..."
          rows={3}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none disabled:opacity-60"
        />
      </div>

      {/* Save checklist */}
      {isPending && (
        <Button size="sm" variant="secondary" onClick={saveChecklist} loading={saving}>
          <Save size={13} /> Save Checklist
        </Button>
      )}

      {/* Approve / Reject */}
      {isPending && canApprove && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Decision</p>
          <textarea
            value={resultNotes}
            onChange={e => setResultNotes(e.target.value)}
            placeholder="Notes about the approval/rejection decision..."
            rows={2}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none mb-3"
          />
          <div className="flex gap-3">
            <Button
              onClick={() => handleDecision('approved')}
              loading={actioning === 'approved'}
              disabled={checkedCount < CHECKLIST_ITEMS.length}
              className="flex-1 bg-green-700 hover:bg-green-600 text-white"
            >
              <CheckCircle size={14} /> Approve
            </Button>
            <Button
              onClick={() => handleDecision('rejected')}
              loading={actioning === 'rejected'}
              variant="danger"
              className="flex-1"
            >
              <XCircle size={14} /> Reject
            </Button>
          </div>
          {checkedCount < CHECKLIST_ITEMS.length && (
            <p className="text-xs text-slate-500 mt-2 text-center">Complete all checklist items to approve</p>
          )}
        </div>
      )}
    </div>
  )
}
