'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, CheckCircle2, Trash2, Link as LinkIcon, Loader2 } from 'lucide-react'

interface DuplicateRecord {
  id: string
  primary_lead_id: string
  duplicate_lead_id: string
  duplicate_reason: 'phone' | 'email' | 'company_name'
  status: 'flagged' | 'merged' | 'manual_review'
  notes: string
  created_at: string
  merged_at?: string
  primary_lead?: { id: string; company_name: string }
  duplicate_lead?: { id: string; company_name: string }
}

interface LeadInfo {
  [key: string]: { id: string; company_name: string; phone?: string; email?: string }
}

export function DuplicateLeadsManager() {
  const [duplicates, setDuplicates] = useState<DuplicateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [leadInfo, setLeadInfo] = useState<LeadInfo>({})
  const supabase = createClient()

  useEffect(() => {
    loadDuplicates()
  }, [])

  async function loadDuplicates() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('duplicate_lead_records')
        .select('*')
        .eq('status', 'flagged')
        .order('created_at', { ascending: false })

      if (error) {
        if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
          alert('Database table not found. Please run the migration first.\n\nRun: supabase migration up')
        }
        throw error
      }

      setDuplicates(data || [])

      // Load lead details
      const allLeadIds = new Set<string>()
      data?.forEach(d => {
        allLeadIds.add(d.primary_lead_id)
        allLeadIds.add(d.duplicate_lead_id)
      })

      if (allLeadIds.size > 0) {
        const { data: leads } = await supabase
          .from('leads')
          .select('id, company_name, phone, email')
          .in('id', Array.from(allLeadIds))

        const infoMap: LeadInfo = {}
        leads?.forEach(lead => {
          infoMap[lead.id] = lead
        })
        setLeadInfo(infoMap)
      }
    } catch (err) {
      console.error('Failed to load duplicates:', err)
    } finally {
      setLoading(false)
    }
  }

  async function runDuplicateScan() {
    setScanning(true)
    try {
      const res = await fetch('/api/admin/find-duplicates?action=flag')
      const result = await res.json()

      if (result.success) {
        alert(`Scan complete!\nFound: ${result.report.summary.totalDuplicates} duplicates\nFlagged: ${result.flagResult?.flagged} pairs\nSkipped: ${result.flagResult?.skipped} (already in database)`)
        loadDuplicates()
      } else {
        alert(`Error: ${result.error}`)
      }
    } catch (err) {
      alert('Failed to run scan')
      console.error(err)
    } finally {
      setScanning(false)
    }
  }

  async function markAsResolved(duplicateId: string, action: 'merged' | 'manual_review') {
    try {
      const { error } = await supabase
        .from('duplicate_lead_records')
        .update({
          status: action,
          merged_at: new Date().toISOString(),
        })
        .eq('id', duplicateId)

      if (error) throw error

      setDuplicates(d => d.filter(dup => dup.id !== duplicateId))
    } catch (err) {
      console.error('Failed to update status:', err)
      alert('Failed to update duplicate status')
    }
  }

  const reasonBadgeColor = {
    phone: 'bg-blue-900/30 text-blue-200 border-blue-700',
    email: 'bg-purple-900/30 text-purple-200 border-purple-700',
    company_name: 'bg-amber-900/30 text-amber-200 border-amber-700',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Duplicate Leads</h2>
          <p className="text-sm text-slate-400 mt-1">{duplicates.length} flagged pairs awaiting review</p>
        </div>
        <Button onClick={runDuplicateScan} disabled={scanning} variant="outline">
          {scanning ? (
            <>
              <Loader2 size={14} className="mr-2 animate-spin" />
              Scanning...
            </>
          ) : (
            'Scan for New Duplicates'
          )}
        </Button>
      </div>

      {duplicates.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-8 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-green-400" />
          <p className="text-slate-300">No duplicate leads found!</p>
          <p className="text-xs text-slate-500 mt-1">All leads are unique. Run a scan to update.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {duplicates.map(dup => (
            <div key={dup.id} className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-3">
              {/* Header with reason badge */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                  <span className={`text-xs font-semibold px-2 py-1 rounded border ${reasonBadgeColor[dup.duplicate_reason]}`}>
                    {dup.duplicate_reason.replace('_', ' ').toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-500">{new Date(dup.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Lead comparison */}
              <div className="grid grid-cols-2 gap-3">
                {/* Primary lead */}
                <div className="rounded bg-slate-700/30 p-3 border border-slate-700">
                  <p className="text-xs font-semibold text-slate-400 mb-2">PRIMARY (Older)</p>
                  <a
                    href={`/leads/${dup.primary_lead_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-orange-400 hover:text-orange-300 flex items-center gap-1"
                  >
                    {leadInfo[dup.primary_lead_id]?.company_name || 'Unknown'}
                    <LinkIcon size={12} />
                  </a>
                  {leadInfo[dup.primary_lead_id]?.phone && (
                    <p className="text-xs text-slate-400 mt-1">{leadInfo[dup.primary_lead_id].phone}</p>
                  )}
                  {leadInfo[dup.primary_lead_id]?.email && (
                    <p className="text-xs text-slate-400">{leadInfo[dup.primary_lead_id].email}</p>
                  )}
                </div>

                {/* Duplicate lead */}
                <div className="rounded bg-slate-700/30 p-3 border border-red-700/50">
                  <p className="text-xs font-semibold text-slate-400 mb-2">DUPLICATE (Newer)</p>
                  <a
                    href={`/leads/${dup.duplicate_lead_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    {leadInfo[dup.duplicate_lead_id]?.company_name || 'Unknown'}
                    <LinkIcon size={12} />
                  </a>
                  {leadInfo[dup.duplicate_lead_id]?.phone && (
                    <p className="text-xs text-slate-400 mt-1">{leadInfo[dup.duplicate_lead_id].phone}</p>
                  )}
                  {leadInfo[dup.duplicate_lead_id]?.email && (
                    <p className="text-xs text-slate-400">{leadInfo[dup.duplicate_lead_id].email}</p>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="text-xs text-slate-500 bg-slate-900/30 px-2 py-1.5 rounded">{dup.notes}</div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAsResolved(dup.id, 'manual_review')}
                  className="text-slate-400 hover:text-slate-300"
                >
                  Mark for Manual Review
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => { if (window.confirm('Mark this duplicate pair as resolved? It will be removed from the review list.')) markAsResolved(dup.id, 'merged') }}
                >
                  <Trash2 size={14} className="mr-1" />
                  Resolved
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
