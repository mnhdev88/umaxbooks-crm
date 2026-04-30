'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Demo } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { Monitor, ExternalLink, Save, Plus, Folder, Clock, Send, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface DevDemoTabProps {
  leadId: string
  leadSlug: string
  userId: string
  companyName: string
}

const BUILD_STEPS = [
  { n: '01', title: 'Clone starter template', detail: 'Use the approved agency template from /templates/starter' },
  { n: '02', title: 'Set client folder path', detail: `Create folder: /clients/{slug}/demo-v{n}` },
  { n: '03', title: 'Customize branding', detail: 'Replace logo, colors, fonts per brief. Use GMB photos if available.' },
  { n: '04', title: 'Upload to staging', detail: 'Deploy to staging server, ensure all pages load correctly' },
  { n: '05', title: 'Submit demo URL', detail: 'Paste the live demo URL below and save to CRM' },
]

export function DevDemoTab({ leadId, leadSlug, userId, companyName }: DevDemoTabProps) {
  const supabase = createClient()
  const [demos, setDemos] = useState<Demo[]>([])
  const [latestApproval, setLatestApproval] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [newUrl, setNewUrl] = useState('')
  const [newVersion, setNewVersion] = useState('')
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { fetchDemos(); fetchLatestApproval() }, [leadId])

  async function fetchDemos() {
    setLoading(true)
    const { data } = await supabase
      .from('demos')
      .select('*, developer:profiles(full_name)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
    if (data) setDemos(data as Demo[])
    setLoading(false)
  }

  async function fetchLatestApproval() {
    const { data } = await supabase
      .from('project_approvals')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setLatestApproval(data)
  }

  async function saveDemoUrl() {
    if (!newUrl.trim()) return
    setSaving(true)
    const nextVersion = newVersion.trim() || `v${demos.length + 1}`
    await supabase.from('demos').insert({
      lead_id: leadId,
      developer_id: userId,
      temp_url: newUrl.trim(),
      demo_version: nextVersion,
      upload_date: new Date().toISOString().split('T')[0],
    })
    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo URL Saved',
      details: `${nextVersion} — ${newUrl.trim()}`,
    })
    setNewUrl('')
    setNewVersion('')
    setSaving(false)
    fetchDemos()
  }

  async function submitForApproval() {
    const latestDemo = demos[0]
    if (!latestDemo?.temp_url) return
    setSubmitting(true)

    await supabase.from('project_approvals').insert({
      lead_id: leadId,
      developer_id: userId,
      demo_url: latestDemo.temp_url,
      status: 'pending',
    })

    await supabase
      .from('leads')
      .update({ status: 'Demo Done', updated_at: new Date().toISOString() })
      .eq('id', leadId)

    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map(a => ({
          user_id: a.id,
          lead_id: leadId,
          title: 'Demo Ready for Review',
          message: `${companyName} — demo submitted for approval.`,
          type: 'info',
        }))
      )
    }

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Submitted for Approval',
      details: `Demo URL: ${latestDemo.temp_url}`,
    })

    setSubmitting(false)
    fetchLatestApproval()
  }

  const folderPath = `/clients/${leadSlug}/demo-v${demos.length + 1}`

  const isPending = latestApproval?.status === 'pending'
  const isDeclined = latestApproval?.status === 'declined'
  const isApproved = latestApproval?.status === 'approved'

  return (
    <div className="space-y-5">

      {/* Revision notes banner (shown when last submission was declined) */}
      {isDeclined && latestApproval?.revision_notes && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300 mb-1">Demo Declined — Revision Required</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{latestApproval.revision_notes}</p>
          </div>
        </div>
      )}

      {/* Approved banner */}
      {isApproved && (
        <div className="bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3.5 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-300">Demo approved by admin — sales agent has been notified.</p>
        </div>
      )}

      {/* Pending banner */}
      {isPending && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3.5 flex items-center gap-3">
          <Clock size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-300">Demo submitted — awaiting admin approval.</p>
        </div>
      )}

      {/* Build instructions */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Build Instructions</p>
        <div className="space-y-3">
          {BUILD_STEPS.map(step => (
            <div key={step.n} className="flex gap-3">
              <span className="text-xs font-mono font-bold text-orange-400 mt-0.5 flex-shrink-0 w-5">{step.n}</span>
              <div>
                <p className="text-sm font-medium text-slate-200">{step.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Client folder path */}
      <div className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5">
        <Folder size={14} className="text-orange-400 flex-shrink-0" />
        <p className="text-xs font-mono text-slate-300 flex-1">{folderPath}</p>
        <button
          onClick={() => navigator.clipboard.writeText(folderPath)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Copy
        </button>
      </div>

      {/* Submit demo URL */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Submit Demo URL</p>
        <div className="flex gap-2 mb-2">
          <input
            value={newVersion}
            onChange={e => setNewVersion(e.target.value)}
            placeholder="Version (e.g. v1)"
            className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
          <input
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="https://demo.staging.com/client-name"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={saveDemoUrl} loading={saving} disabled={!newUrl.trim()}>
            <Save size={13} /> Save to CRM
          </Button>
        </div>
      </div>

      {/* Submit for admin approval */}
      {demos.length > 0 && !isPending && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            {isDeclined ? 'Resubmit for Approval' : 'Submit for Admin Approval'}
          </p>
          <p className="text-xs text-slate-500 mb-3">
            Uses the latest saved demo URL: <span className="text-blue-400">{demos[0]?.temp_url}</span>
          </p>
          <Button onClick={submitForApproval} loading={submitting} disabled={!demos[0]?.temp_url}>
            <Send size={13} /> {isDeclined ? 'Resubmit Demo' : 'Submit Demo to Admin'}
          </Button>
        </div>
      )}

      {/* Version history */}
      {!loading && demos.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Version History</p>
          <div className="space-y-2.5">
            {demos.map((demo, idx) => (
              <div key={demo.id} className={`flex items-center gap-3 p-3 rounded-lg ${idx === 0 ? 'bg-orange-900/15 border border-orange-700/25' : 'bg-slate-800'}`}>
                <Monitor size={15} className={idx === 0 ? 'text-orange-400' : 'text-slate-500'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">{demo.demo_version || `v${demos.length - idx}`}</span>
                    {idx === 0 && <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-300 rounded">Latest</span>}
                  </div>
                  {demo.temp_url && (
                    <a href={demo.temp_url} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 truncate block mt-0.5">
                      {demo.temp_url}
                    </a>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{formatDate(demo.created_at)}</p>
                  {demo.temp_url && (
                    <a href={demo.temp_url} target="_blank" rel="noreferrer"
                      className="mt-1 inline-flex text-slate-400 hover:text-orange-400">
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
