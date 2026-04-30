'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BeforeAfterComparison, BeforeAfterMetric } from '@/types'
import { Button } from '@/components/ui/Button'
import { Image, Upload, Plus, Trash2, Save, Sparkles, FileText, RotateCcw } from 'lucide-react'

interface DevBeforeAfterTabProps {
  leadId: string
  leadSlug: string
  userId: string
}

const DEFAULT_METRICS = [
  { metric_name: 'PageSpeed — Mobile',    before_value: '', after_value: '89 / 100',               business_impact: '53% of mobile visitors leave slow sites. Fixed.',           sort_order: 0 },
  { metric_name: 'Local keywords ranked', before_value: '', after_value: '14 keywords',             business_impact: '3× more search visibility for local searches.',             sort_order: 1 },
  { metric_name: 'Schema markup',         before_value: '', after_value: 'LocalBusiness + FAQPage', business_impact: 'Enables star ratings and address in Google search.',         sort_order: 2 },
  { metric_name: 'Mobile CTA',            before_value: '', after_value: 'Sticky Book Now button',  business_impact: 'CTAs above fold improve conversions by 40%+.',               sort_order: 3 },
  { metric_name: 'GMB consistency',       before_value: '', after_value: 'Fully synced',            business_impact: 'Top local SEO ranking signal — now working for them.',       sort_order: 4 },
  { metric_name: 'PageSpeed — Desktop',   before_value: '', after_value: '96 / 100',               business_impact: 'Better UX across all devices. Lower bounce rate.',           sort_order: 5 },
]

export function DevBeforeAfterTab({ leadId, leadSlug, userId }: DevBeforeAfterTabProps) {
  const supabase = createClient()
  const [comparison, setComparison] = useState<BeforeAfterComparison | null>(null)
  const [metrics, setMetrics] = useState<BeforeAfterMetric[]>([])
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingBefore, setUploadingBefore] = useState(false)
  const [uploadingAfter, setUploadingAfter] = useState(false)
  const [auditPdfUrl, setAuditPdfUrl] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const beforeRef = useRef<HTMLInputElement>(null)
  const afterRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [leadId])

  async function fetchData() {
    const [compResult, metsResult, auditResult] = await Promise.all([
      supabase.from('before_after_comparisons').select('*').eq('lead_id', leadId).limit(1).maybeSingle(),
      supabase.from('before_after_metrics').select('*').eq('lead_id', leadId).order('sort_order'),
      supabase.from('audits').select('audit_short_pdf_url').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const comp = compResult.data
    const mets = metsResult.data
    if (comp) {
      setComparison(comp as BeforeAfterComparison)
      setSummary(comp.developer_summary || '')
    }
    setMetrics(mets && mets.length > 0 ? (mets as BeforeAfterMetric[]) : DEFAULT_METRICS.map(m => ({ ...m, id: '', lead_id: leadId, created_at: '' })))
    setAuditPdfUrl((auditResult.data as any)?.audit_short_pdf_url || null)
  }

  async function extractFromPdf() {
    if (!auditPdfUrl) return
    setExtracting(true)
    setExtractError(null)
    try {
      const pdfResp = await fetch(auditPdfUrl)
      if (!pdfResp.ok) throw new Error(`Could not load PDF (${pdfResp.status})`)
      const blob = await pdfResp.blob()
      const form = new FormData()
      form.append('file', blob, 'audit.pdf')
      const res = await fetch('/api/extract-pdf-metrics', { method: 'POST', body: form })
      let data: any
      try { data = await res.json() } catch { data = {} }
      if (!res.ok || data.error) { setExtractError(data.error || `Server error (${res.status})`); return }
      if (data.metrics?.length > 0) {
        setMetrics(data.metrics.map((m: any, i: number) => ({
          id: '', lead_id: leadId, created_at: '',
          metric_name: m.metric_name || '',
          before_value: m.before_value || '',
          after_value: m.after_value || '',
          business_impact: m.business_impact || '',
          sort_order: i,
        })))
      }
      if (data.developer_summary) setSummary(data.developer_summary)
    } catch (e: any) {
      setExtractError(e.message || 'Something went wrong')
    } finally {
      setExtracting(false)
    }
  }

  async function uploadScreenshot(file: File, type: 'before' | 'after') {
    const setter = type === 'before' ? setUploadingBefore : setUploadingAfter
    setter(true)
    const folder = `${leadSlug}/before-after`
    const ext = file.name.split('.').pop()
    const fileName = `${type}_${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('crm-files').upload(`${folder}/${fileName}`, file, { upsert: true })
    if (!error) {
      const { data: urlData } = supabase.storage.from('crm-files').getPublicUrl(`${folder}/${fileName}`)
      const field = type === 'before' ? 'before_screenshot_url' : 'after_screenshot_url'
      if (comparison?.id) {
        await supabase.from('before_after_comparisons').update({ [field]: urlData.publicUrl }).eq('id', comparison.id)
      } else {
        await supabase.from('before_after_comparisons').insert({ lead_id: leadId, [field]: urlData.publicUrl, created_by: userId })
      }
      fetchData()
    }
    setter(false)
  }

  async function saveAll() {
    setSaving(true)
    const compData = { developer_summary: summary, updated_at: new Date().toISOString() }
    if (comparison?.id) {
      await supabase.from('before_after_comparisons').update(compData).eq('id', comparison.id)
    } else {
      await supabase.from('before_after_comparisons').insert({ lead_id: leadId, ...compData, created_by: userId })
    }
    await supabase.from('before_after_metrics').delete().eq('lead_id', leadId)
    const validMetrics = metrics.filter(m => m.metric_name.trim())
    if (validMetrics.length > 0) {
      await supabase.from('before_after_metrics').insert(
        validMetrics.map((m, i) => ({
          lead_id: leadId,
          metric_name: m.metric_name,
          before_value: m.before_value || null,
          after_value: m.after_value || null,
          business_impact: (m as any).business_impact || null,
          sort_order: i,
        }))
      )
    }
    await supabase.from('activity_logs').insert({ lead_id: leadId, user_id: userId, action: 'Before/After Updated', details: 'Developer updated before/after comparison.' })
    setSaving(false)
    fetchData()
  }

  function resetToDefaults() {
    setMetrics(DEFAULT_METRICS.map(m => ({ ...m, id: '', lead_id: leadId, created_at: '' })))
  }

  function addMetricRow() {
    setMetrics(prev => [...prev, { id: '', lead_id: leadId, metric_name: '', before_value: '', after_value: '', sort_order: prev.length, created_at: '' }])
  }

  function removeMetric(idx: number) {
    setMetrics(prev => prev.filter((_, i) => i !== idx))
  }

  function updateMetric(idx: number, field: string, value: string) {
    setMetrics(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  return (
    <div className="space-y-5">

      {/* Screenshots */}
      <div className="grid grid-cols-2 gap-4">
        {(['before', 'after'] as const).map(type => {
          const url = type === 'before' ? comparison?.before_screenshot_url : comparison?.after_screenshot_url
          const uploading = type === 'before' ? uploadingBefore : uploadingAfter
          const ref = type === 'before' ? beforeRef : afterRef
          return (
            <div key={type} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {type === 'before' ? '📸 Before' : '✨ After'}
              </p>
              {url ? (
                <div className="relative group">
                  <img src={url} alt={type} className="w-full h-36 object-cover rounded-lg border border-slate-700" />
                  <button
                    onClick={() => ref.current?.click()}
                    className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg"
                  >
                    <Upload size={18} className="text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => ref.current?.click()}
                  className="w-full h-36 border-2 border-dashed border-slate-700 hover:border-orange-500/60 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-slate-400 transition-colors"
                >
                  {uploading ? <span className="text-xs">Uploading...</span> : <><Image size={20} /><span className="text-xs">Upload screenshot</span></>}
                </button>
              )}
              <input ref={ref} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && uploadScreenshot(e.target.files[0], type)} />
            </div>
          )
        })}
      </div>

      {/* Extract from audit PDF */}
      <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-2.5">
          <FileText size={15} className="text-orange-400 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-slate-300">Extract from Summary Audit PDF</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {auditPdfUrl ? 'Uses the summary audit PDF uploaded in the Audit Reports tab' : 'No summary audit PDF uploaded yet'}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={extractFromPdf} loading={extracting} disabled={extracting || !auditPdfUrl}>
          <Sparkles size={12} /> {extracting ? 'Extracting…' : 'Extract Metrics'}
        </Button>
      </div>
      {extractError && <p className="text-xs text-red-400 flex items-center gap-1.5 -mt-2">⚠ {extractError}</p>}

      {/* Metrics table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Metrics Comparison</p>
          <div className="flex items-center gap-3">
            <button onClick={resetToDefaults} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
              <RotateCcw size={11} /> Reset to Defaults
            </button>
            <button onClick={addMetricRow} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300">
              <Plus size={12} /> Add Row
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_110px_110px_1fr_36px] gap-2 text-xs font-medium text-slate-500 px-1 mb-1">
            <span>Metric</span><span>Before</span><span>After</span><span>Business Impact</span><span />
          </div>
          {metrics.map((m, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_110px_110px_1fr_36px] gap-2 items-center">
              <input value={m.metric_name} onChange={e => updateMetric(idx, 'metric_name', e.target.value)}
                placeholder="Metric name"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500" />
              <input value={m.before_value || ''} onChange={e => updateMetric(idx, 'before_value', e.target.value)}
                placeholder="Before"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500" />
              <input value={m.after_value || ''} onChange={e => updateMetric(idx, 'after_value', e.target.value)}
                placeholder="After"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500" />
              <input value={(m as any).business_impact || ''} onChange={e => updateMetric(idx, 'business_impact', e.target.value)}
                placeholder="Business impact"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500" />
              <button onClick={() => removeMetric(idx)} className="text-slate-600 hover:text-red-400 transition-colors flex justify-center">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Developer summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Developer Summary — Read to Client</p>
        <textarea
          value={summary}
          onChange={e => setSummary(e.target.value)}
          placeholder="Write a summary of the improvements made, technical changes, and expected business impact..."
          rows={5}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-500 resize-none"
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={saveAll} loading={saving}>
          <Save size={13} /> Save All Changes
        </Button>
      </div>
    </div>
  )
}
