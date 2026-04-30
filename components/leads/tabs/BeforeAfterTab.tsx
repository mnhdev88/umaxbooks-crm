'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BeforeAfterViewTab } from '@/components/demo-close/BeforeAfterViewTab'
import { Button } from '@/components/ui/Button'
import { Sparkles, FileText, AlertCircle, CheckCircle2 } from 'lucide-react'

interface BeforeAfterTabProps {
  leadId: string
  lead: any
  userId: string
}

export function BeforeAfterTab({ leadId, lead, userId }: BeforeAfterTabProps) {
  const supabase = createClient()
  const [comparison, setComparison]     = useState<any>(null)
  const [metrics, setMetrics]           = useState<any[]>([])
  const [auditPdfUrl, setAuditPdfUrl]   = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [extracting, setExtracting]     = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [extractSuccess, setExtractSuccess] = useState(false)

  useEffect(() => { fetchData() }, [leadId])

  async function fetchData() {
    setLoading(true)
    const [compResult, metsResult, auditResult] = await Promise.all([
      supabase.from('before_after_comparisons').select('*').eq('lead_id', leadId).limit(1).maybeSingle(),
      supabase.from('before_after_metrics').select('*').eq('lead_id', leadId).order('sort_order'),
      supabase.from('audits').select('audit_short_pdf_url').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    setComparison(compResult.data || null)
    setMetrics(metsResult.data || [])
    setAuditPdfUrl((auditResult.data as any)?.audit_short_pdf_url || null)
    setLoading(false)
  }

  async function extractFromPdf() {
    if (!auditPdfUrl) return
    setExtracting(true)
    setExtractError(null)
    setExtractSuccess(false)
    try {
      // Fetch the PDF blob client-side (browser can reach local Supabase storage)
      const pdfResp = await fetch(auditPdfUrl)
      if (!pdfResp.ok) throw new Error(`Could not load PDF (${pdfResp.status})`)
      const blob = await pdfResp.blob()

      const form = new FormData()
      form.append('file', blob, 'audit.pdf')

      const res = await fetch('/api/extract-pdf-metrics', { method: 'POST', body: form })
      let data: any
      try { data = await res.json() } catch { data = {} }
      if (!res.ok || data.error) {
        setExtractError(data.error || `Server error (${res.status})`)
        return
      }

      // Save comparison + summary
      const compData = { developer_summary: data.developer_summary || '', updated_at: new Date().toISOString() }
      let compId = comparison?.id
      if (compId) {
        await supabase.from('before_after_comparisons').update(compData).eq('id', compId)
      } else {
        const { data: newComp } = await supabase
          .from('before_after_comparisons')
          .insert({ lead_id: leadId, ...compData, created_by: userId })
          .select().single()
        compId = newComp?.id
      }

      // Save metrics
      if (data.metrics?.length > 0) {
        await supabase.from('before_after_metrics').delete().eq('lead_id', leadId)
        await supabase.from('before_after_metrics').insert(
          data.metrics.map((m: any, i: number) => ({
            lead_id: leadId,
            metric_name: m.metric_name || '',
            before_value: m.before_value || null,
            after_value: m.after_value || null,
            business_impact: m.business_impact || null,
            sort_order: i,
          }))
        )
      }

      await supabase.from('activity_logs').insert({
        lead_id: leadId, user_id: userId,
        action: 'Before/After Extracted',
        details: `Extracted ${data.metrics?.length || 0} metrics from summary audit PDF`,
      })

      setExtractSuccess(true)
      await fetchData()
    } catch (e: any) {
      setExtractError(e.message || 'Something went wrong')
    } finally {
      setExtracting(false)
    }
  }

  if (loading) {
    return <div className="text-center py-10 text-slate-500 text-sm">Loading...</div>
  }

  return (
    <div className="space-y-4">

      {/* Extract from uploaded audit PDF */}
      <div className="flex items-center justify-between bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2.5">
          <FileText size={15} className="text-orange-400 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-slate-300">Extract from Summary Audit PDF</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {auditPdfUrl
                ? 'Uses the summary audit PDF uploaded in the Audits tab'
                : 'No summary audit PDF uploaded yet — go to the Audits tab to upload one'}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={extractFromPdf} loading={extracting} disabled={extracting || !auditPdfUrl}>
          <Sparkles size={12} /> {extracting ? 'Extracting…' : 'Extract Metrics'}
        </Button>
      </div>

      {extractSuccess && (
        <p className="text-xs text-green-400 flex items-center gap-1.5 -mt-2">
          <CheckCircle2 size={12} /> Metrics extracted and saved successfully.
        </p>
      )}
      {extractError && (
        <p className="text-xs text-red-400 flex items-center gap-1.5 -mt-2">
          <AlertCircle size={12} /> {extractError}
        </p>
      )}

      <BeforeAfterViewTab lead={lead} comparison={comparison} metrics={metrics} />
    </div>
  )
}
