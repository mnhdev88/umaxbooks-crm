'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Demo } from '@/types'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { Monitor, ExternalLink, Folder, Clock, Send, AlertTriangle, CheckCircle2, Hammer, UserCheck } from 'lucide-react'
import { ensureHttps } from '@/lib/utils'
import { notifyLeadManagers } from '@/lib/notify/managers'
import { toast } from 'sonner'

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
  { n: '05', title: 'Submit demo URL', detail: 'Paste the live demo URL below and submit for admin approval' },
]

export function DevDemoTab({ leadId, leadSlug, userId, companyName }: DevDemoTabProps) {
  const supabase = createClient()
  const [demos, setDemos] = useState<Demo[]>([])
  const [latestApproval, setLatestApproval] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [newUrl, setNewUrl] = useState('')
  const [newVersion, setNewVersion] = useState('')
  const [saving, setSaving] = useState(false)
  const [build, setBuild] = useState<any>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => { fetchDemos(); fetchLatestApproval(); fetchBuild() }, [leadId])

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

  async function fetchBuild() {
    const { data } = await supabase
      .from('demo_builds')
      .select('*, developer:profiles(full_name)')
      .eq('lead_id', leadId)
      .maybeSingle()
    setBuild(data)
  }

  /**
   * Claim the demo and tell the sales manager work has begun. The queue is
   * shared and unfiltered, so this is the first point at which a specific
   * developer is attached to a specific lead.
   */
  async function startBuild() {
    setStarting(true)

    // Two developers can hit Start at the same moment. The unique index on
    // lead_id makes the DB pick a winner; ignoreDuplicates turns the loser's
    // insert into a no-op rather than an error, and the refetch below shows
    // them who actually holds the claim.
    const { error } = await supabase
      .from('demo_builds')
      .upsert({
        lead_id: leadId,
        developer_id: userId,
        status: 'building',
        started_at: new Date().toISOString(),
      }, { onConflict: 'lead_id', ignoreDuplicates: true })

    if (error) {
      toast.error(`Could not start the build: ${error.message}`)
      setStarting(false)
      return
    }

    const { data: claimed } = await supabase
      .from('demo_builds')
      .select('*, developer:profiles(full_name)')
      .eq('lead_id', leadId)
      .maybeSingle()

    setBuild(claimed)
    setStarting(false)

    // Someone else won the race — don't log or notify on their behalf.
    if (claimed && claimed.developer_id !== userId) {
      toast.error(`${claimed.developer?.full_name || 'Another developer'} already started this build.`)
      return
    }

    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', userId).single()
    const who = me?.full_name || 'A developer'

    await notifyLeadManagers(supabase, leadId, {
      title: 'Demo Build Started',
      message: `${who} started building the demo for ${companyName}.`,
      type: 'info',
    }, userId)

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Build Started',
      details: `${who} began building the demo.`,
    })

    toast.success('Build started — the sales manager has been notified.')
  }

  // Save URL to demos table AND immediately create approval record
  async function saveAndSubmit() {
    if (!newUrl.trim()) return
    setSaving(true)
    const url = ensureHttps(newUrl.trim())
    const nextVersion = newVersion.trim() || `v${demos.length + 1}`

    // The demos row is what the Demo tab renders from; the approval only attaches
    // to it by matching URL. If the demo insert fails but we still create the
    // approval, an admin can approve an "invisible" demo that never shows in the
    // sales agent's Demo tab. So abort if the demo row didn't save.
    const { error: demoError } = await supabase.from('demos').insert({
      lead_id: leadId,
      developer_id: userId,
      temp_url: url,
      demo_version: nextVersion,
      upload_date: new Date().toISOString().split('T')[0],
    })

    if (demoError) {
      toast.error(`Could not save the demo: ${demoError.message}. Please try again.`)
      setSaving(false)
      return
    }

    const { error: approvalError } = await supabase.from('project_approvals').insert({
      lead_id: leadId,
      developer_id: userId,
      demo_url: url,
      status: 'pending',
    })

    if (approvalError) {
      toast.error(`Demo saved, but submitting for approval failed: ${approvalError.message}. Please resubmit.`)
      setSaving(false)
      fetchDemos()
      return
    }

    await supabase
      .from('leads')
      .update({ status: 'Demo Done', updated_at: new Date().toISOString() })
      .eq('id', leadId)

    // Close out the build claim. A demo submitted without ever clicking Start
    // (the pre-098 habit) still gets a row, so the manager's view and the stall
    // cron both stay accurate.
    await supabase.from('demo_builds').upsert({
      lead_id: leadId,
      developer_id: userId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      stall_alerted_at: null,
    }, { onConflict: 'lead_id' })

    // In-app notifications to all admins
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map((a: any) => ({
          user_id: a.id,
          lead_id: leadId,
          title: 'Demo Ready for Review',
          message: `${companyName} — demo submitted for approval.`,
          type: 'info',
        }))
      )
    }

    // The manager whose agent booked this demo hears about it too — admins
    // approve, but the manager is the one chasing the client call.
    await notifyLeadManagers(supabase, leadId, {
      title: 'Demo Submitted for Approval',
      message: `${companyName} — the demo is built and awaiting admin approval.`,
      type: 'info',
    }, userId)

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Submitted for Approval',
      details: `${nextVersion} — ${url}`,
    })

    // Email admins
    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', userId).single()
    await fetch('/api/demo-approval-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, demoUrl: url, companyName, developerName: me?.full_name || '' }),
    })

    setNewUrl('')
    setNewVersion('')
    setSaving(false)
    fetchDemos()
    fetchLatestApproval()
    fetchBuild()
  }

  // Resubmit existing latest demo after a decline
  async function resubmit() {
    const latestDemo = demos[0]
    if (!latestDemo?.temp_url) return
    setSaving(true)

    await supabase.from('project_approvals').insert({
      lead_id: leadId,
      developer_id: userId,
      demo_url: latestDemo.temp_url,
      status: 'pending',
    })

    await supabase.from('demo_builds').upsert({
      lead_id: leadId,
      developer_id: userId,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      stall_alerted_at: null,
    }, { onConflict: 'lead_id' })

    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map((a: any) => ({
          user_id: a.id,
          lead_id: leadId,
          title: 'Demo Resubmitted for Review',
          message: `${companyName} — demo resubmitted after revision.`,
          type: 'info',
        }))
      )
    }

    await notifyLeadManagers(supabase, leadId, {
      title: 'Demo Resubmitted for Approval',
      message: `${companyName} — the revised demo is awaiting admin approval.`,
      type: 'info',
    }, userId)

    await supabase.from('activity_logs').insert({
      lead_id: leadId,
      user_id: userId,
      action: 'Demo Resubmitted',
      details: `Demo URL: ${latestDemo.temp_url}`,
    })

    const { data: me } = await supabase.from('profiles').select('full_name').eq('id', userId).single()
    await fetch('/api/demo-approval-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, demoUrl: latestDemo.temp_url, companyName, developerName: me?.full_name || '' }),
    })

    setSaving(false)
    fetchLatestApproval()
    fetchBuild()
  }

  const folderPath = `/clients/${leadSlug}/demo-v${demos.length + 1}`
  const isPending = latestApproval?.status === 'pending'
  const isDeclined = latestApproval?.status === 'declined'
  const isApproved = latestApproval?.status === 'approved'

  const isBuilding  = build?.status === 'building'
  const mineToBuild = build?.developer_id === userId
  // Offer Start only when nobody holds the claim and there's nothing in review.
  const canStart    = !build && !isPending && !isApproved

  return (
    <div className="space-y-5">

      {/* Status banners */}
      {isDeclined && latestApproval?.revision_notes && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl px-4 py-3.5 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300 mb-1">Demo Declined — Revision Required</p>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{latestApproval.revision_notes}</p>
          </div>
        </div>
      )}
      {isApproved && (
        <div className="bg-green-900/20 border border-green-700/40 rounded-xl px-4 py-3.5 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
          <p className="text-sm font-semibold text-green-300">Demo approved — sales agent has been notified.</p>
        </div>
      )}
      {isPending && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3.5 flex items-center gap-3">
          <Clock size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-300">Demo submitted — awaiting admin approval.</p>
        </div>
      )}

      {/* Claim the build. Until someone clicks this, nobody outside the dev
          queue can tell whether the demo has been touched at all. */}
      {canStart && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-start gap-3">
          <Hammer size={16} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-200">Ready to build?</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">
              Claim this demo so the team knows you&apos;re on it. The sales manager is notified that work has started.
            </p>
            <Button onClick={startBuild} loading={starting}>
              <Hammer size={13} /> Start Build
            </Button>
          </div>
        </div>
      )}

      {isBuilding && (
        <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl px-4 py-3.5 flex items-center gap-3">
          <UserCheck size={16} className="text-blue-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-300">
              {mineToBuild ? 'You are building this demo' : `${build?.developer?.full_name || 'Another developer'} is building this demo`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Started {formatDate(build.started_at)}
              {mineToBuild ? ' — submit the URL below when it’s ready.' : ''}
            </p>
          </div>
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

      {/* Submit demo URL — hidden while pending/approved */}
      {!isPending && !isApproved && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
            {isDeclined ? 'Submit New Version for Approval' : 'Submit Demo for Approval'}
          </p>
          <p className="text-xs text-slate-500 mb-3">Saves the URL and immediately notifies admin for review.</p>
          <div className="flex gap-2 mb-3">
            <input
              value={newVersion}
              onChange={e => setNewVersion(e.target.value)}
              placeholder="Version (e.g. v2)"
              className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />
            <input
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://demo.staging.com/client-name"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500"
            />
          </div>
          <Button onClick={saveAndSubmit} loading={saving} disabled={!newUrl.trim()}>
            <Send size={13} /> Submit for Approval
          </Button>
        </div>
      )}

      {/* Resubmit (same URL) after decline — shortcut if URL hasn't changed */}
      {isDeclined && demos[0]?.temp_url && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Resubmit Same URL</p>
          <p className="text-xs text-slate-500 mb-3">
            Resubmit without changes: <span className="text-blue-400">{demos[0].temp_url}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={resubmit} loading={saving}>
            <Send size={13} /> Resubmit Demo
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
                    <a href={ensureHttps(demo.temp_url)} target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 truncate block mt-0.5">
                      {demo.temp_url}
                    </a>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-slate-500">{formatDate(demo.created_at)}</p>
                  {demo.temp_url && (
                    <a href={ensureHttps(demo.temp_url)} target="_blank" rel="noreferrer"
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
