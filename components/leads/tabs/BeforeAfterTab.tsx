'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BeforeAfterViewTab } from '@/components/demo-close/BeforeAfterViewTab'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Sparkles, FileText, AlertCircle, CheckCircle2, Gauge, RefreshCw, Clock, Search, XCircle, MinusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

function scoreColor(score: number) {
  if (score >= 90) return 'text-green-400'
  if (score >= 50) return 'text-amber-400'
  return 'text-red-400'
}

function scoreBg(score: number) {
  if (score >= 90) return 'bg-green-900/30 border-green-700/40'
  if (score >= 50) return 'bg-amber-900/30 border-amber-700/40'
  return 'bg-red-900/30 border-red-700/40'
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div className={cn('flex flex-col items-center gap-0.5 rounded-lg border px-3 py-2 min-w-[72px]', scoreBg(score))}>
      <span className={cn('text-xl font-bold leading-none', scoreColor(score))}>{score}</span>
      <span className="text-[10px] text-slate-400 text-center leading-tight">{label}</span>
    </div>
  )
}

function MetricRow({ label, value, compareValue }: { label: string; value: string; compareValue?: string }) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-700/30 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-mono">{value}</span>
    </div>
  )
}

function PageSpeedPanel({
  title,
  data,
  url,
  onFetch,
  fetching,
  fetchedAt,
}: {
  title: string
  data: any
  url: string
  onFetch: () => void
  fetching: boolean
  fetchedAt?: string
}) {
  return (
    <div className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</span>
        <Button size="sm" variant="ghost" onClick={onFetch} loading={fetching}>
          <RefreshCw size={12} /> {data ? 'Re-fetch' : 'Fetch'}
        </Button>
      </div>

      {url && <p className="text-[10px] text-slate-500 truncate font-mono">{url}</p>}

      {!data && !fetching && (
        <p className="text-xs text-slate-600 text-center py-4">Click Fetch to run PageSpeed</p>
      )}

      {data && (
        <>
          {/* Category scores */}
          <div className="flex flex-wrap gap-2">
            <ScoreCard label="Performance" score={data.scores.performance} />
            <ScoreCard label="SEO"         score={data.scores.seo} />
            <ScoreCard label="Accessibility" score={data.scores.accessibility} />
            <ScoreCard label="Best Practices" score={data.scores.bestPractices} />
          </div>

          {/* Core Web Vitals */}
          <div className="bg-slate-900/60 rounded-lg px-3 py-2 space-y-0.5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Core Web Vitals</p>
            <MetricRow label="LCP"         value={data.metrics.lcp} />
            <MetricRow label="FCP"         value={data.metrics.fcp} />
            <MetricRow label="CLS"         value={data.metrics.cls} />
            <MetricRow label="TBT"         value={data.metrics.tbt} />
            <MetricRow label="Speed Index" value={data.metrics.speedIndex} />
            <MetricRow label="TTI"         value={data.metrics.tti} />
          </div>

          {fetchedAt && (
            <p className="text-[10px] text-slate-600 flex items-center gap-1">
              <Clock size={9} /> Fetched {new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

const STATUS_ICON = {
  pass: { Icon: CheckCircle2, color: 'text-green-400' },
  warn: { Icon: MinusCircle, color: 'text-amber-400' },
  fail: { Icon: XCircle,     color: 'text-red-400' },
} as const

function CheckRow({ check }: { check: any }) {
  const { Icon, color } = STATUS_ICON[check.status as keyof typeof STATUS_ICON] ?? STATUS_ICON.warn
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-700/30 last:border-0" title={check.impact}>
      <Icon size={13} className={cn('flex-shrink-0 mt-0.5', color)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-slate-300">{check.label}</span>
          <span className="text-[10px] text-slate-500 font-mono text-right truncate max-w-[55%]">{check.value}</span>
        </div>
      </div>
    </div>
  )
}

function SeoPanel({
  title,
  data,
  url,
  onFetch,
  fetching,
  fetchedAt,
}: {
  title: string
  data: any
  url: string
  onFetch: () => void
  fetching: boolean
  fetchedAt?: string
}) {
  return (
    <div className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</span>
        <Button size="sm" variant="ghost" onClick={onFetch} loading={fetching}>
          <RefreshCw size={12} /> {data ? 'Re-scan' : 'Scan'}
        </Button>
      </div>

      {url && <p className="text-[10px] text-slate-500 truncate font-mono">{url}</p>}

      {!data && !fetching && (
        <p className="text-xs text-slate-600 text-center py-4">Click Scan to run the SEO check</p>
      )}

      {data && (
        <>
          <div className="flex items-center gap-3">
            <ScoreCard label="SEO Health" score={data.score} />
            <div className="text-[11px] space-y-0.5">
              <p className="text-green-400">{data.counts.pass} passing</p>
              <p className="text-amber-400">{data.counts.warn} needs work</p>
              <p className="text-red-400">{data.counts.fail} failing</p>
            </div>
            {data.cms && data.cms !== 'Unknown' && (
              <span className="ml-auto self-start text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400">
                {data.cms}
              </span>
            )}
          </div>

          <div className="bg-slate-900/60 rounded-lg px-3 py-2">
            {data.checks.map((c: any) => <CheckRow key={c.key} check={c} />)}
          </div>

          {fetchedAt && (
            <p className="text-[10px] text-slate-600 flex items-center gap-1">
              <Clock size={9} /> Scanned {new Date(fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

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

  // PageSpeed state
  const [psBefore, setPsBefore]         = useState<any>(null)
  const [psAfter, setPsAfter]           = useState<any>(null)
  const [psBeforeAt, setPsBeforeAt]     = useState<string | undefined>()
  const [psAfterAt, setPsAfterAt]       = useState<string | undefined>()
  const [afterUrl, setAfterUrl]         = useState(lead?.website_url || '')
  const [fetchingBefore, setFetchingBefore] = useState(false)
  const [fetchingAfter, setFetchingAfter]   = useState(false)
  const [psError, setPsError]           = useState<string | null>(null)

  // On-page SEO state
  const [seoBefore, setSeoBefore]       = useState<any>(null)
  const [seoAfter, setSeoAfter]         = useState<any>(null)
  const [seoBeforeAt, setSeoBeforeAt]   = useState<string | undefined>()
  const [seoAfterAt, setSeoAfterAt]     = useState<string | undefined>()
  const [scanningBefore, setScanningBefore] = useState(false)
  const [scanningAfter, setScanningAfter]   = useState(false)
  const [seoError, setSeoError]         = useState<string | null>(null)

  useEffect(() => { fetchData() }, [leadId])

  // Load saved PageSpeed data from comparison row
  useEffect(() => {
    if (!comparison) return
    if (comparison.pagespeed_before) { setPsBefore(comparison.pagespeed_before); setPsBeforeAt(comparison.pagespeed_before_at) }
    if (comparison.pagespeed_after)  { setPsAfter(comparison.pagespeed_after);   setPsAfterAt(comparison.pagespeed_after_at) }
    if (comparison.pagespeed_after_url) setAfterUrl(comparison.pagespeed_after_url)
    if (comparison.seo_before) { setSeoBefore(comparison.seo_before); setSeoBeforeAt(comparison.seo_before_at) }
    if (comparison.seo_after)  { setSeoAfter(comparison.seo_after);   setSeoAfterAt(comparison.seo_after_at) }
  }, [comparison])

  async function ensureComparison() {
    if (comparison?.id) return comparison.id
    const { data } = await supabase
      .from('before_after_comparisons')
      .insert({ lead_id: leadId, created_by: userId })
      .select().single()
    setComparison(data)
    return data?.id
  }

  async function fetchPageSpeed(type: 'before' | 'after') {
    setPsError(null)
    const url = type === 'before' ? lead?.website_url : afterUrl
    if (!url) { setPsError('No website URL set for this lead.'); return }
    type === 'before' ? setFetchingBefore(true) : setFetchingAfter(true)
    try {
      const res  = await fetch('/api/pagespeed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (!res.ok || data.error) { setPsError(data.error || 'PageSpeed fetch failed'); return }

      const now   = new Date().toISOString()
      const compId = await ensureComparison()

      const col = type === 'before'
        ? { pagespeed_before: data, pagespeed_before_url: url, pagespeed_before_at: now }
        : { pagespeed_after:  data, pagespeed_after_url:  afterUrl, pagespeed_after_at: now }

      await supabase.from('before_after_comparisons').update(col).eq('id', compId)

      if (type === 'before') { setPsBefore(data); setPsBeforeAt(now) }
      else                   { setPsAfter(data);  setPsAfterAt(now) }
    } catch (e: any) {
      setPsError(e.message || 'Something went wrong')
    } finally {
      type === 'before' ? setFetchingBefore(false) : setFetchingAfter(false)
    }
  }

  async function fetchSeo(type: 'before' | 'after') {
    setSeoError(null)
    const url = type === 'before' ? lead?.website_url : afterUrl
    if (!url) { setSeoError('No website URL set for this lead.'); return }
    type === 'before' ? setScanningBefore(true) : setScanningAfter(true)
    try {
      const res  = await fetch('/api/seo-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      if (!res.ok || data.error) { setSeoError(data.error || 'SEO scan failed'); return }

      const now    = new Date().toISOString()
      const compId = await ensureComparison()

      const col = type === 'before'
        ? { seo_before: data, seo_before_url: url, seo_before_at: now }
        : { seo_after:  data, seo_after_url:  afterUrl, seo_after_at: now }

      await supabase.from('before_after_comparisons').update(col).eq('id', compId)

      if (type === 'before') { setSeoBefore(data); setSeoBeforeAt(now) }
      else                   { setSeoAfter(data);  setSeoAfterAt(now) }
    } catch (e: any) {
      setSeoError(e.message || 'Something went wrong')
    } finally {
      type === 'before' ? setScanningBefore(false) : setScanningAfter(false)
    }
  }

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

      {/* ── PageSpeed Insights ─────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Gauge size={14} className="text-orange-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Google PageSpeed Insights</span>
        </div>

        {/* After URL input */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="New Website URL (After)"
              type="url"
              placeholder="https://newwebsite.com"
              value={afterUrl}
              onChange={(e) => setAfterUrl(e.target.value)}
            />
          </div>
        </div>

        {psError && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={11} /> {psError}
          </p>
        )}

        <div className="flex gap-3 flex-col sm:flex-row">
          <PageSpeedPanel
            title="Before (Current Site)"
            data={psBefore}
            url={lead?.website_url || ''}
            onFetch={() => fetchPageSpeed('before')}
            fetching={fetchingBefore}
            fetchedAt={psBeforeAt}
          />
          <PageSpeedPanel
            title="After (New Site)"
            data={psAfter}
            url={afterUrl}
            onFetch={() => fetchPageSpeed('after')}
            fetching={fetchingAfter}
            fetchedAt={psAfterAt}
          />
        </div>
      </div>

      {/* ── On-Page SEO ────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-orange-400" />
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">On-Page SEO Health</span>
        </div>

        {seoError && (
          <p className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle size={11} /> {seoError}
          </p>
        )}

        <div className="flex gap-3 flex-col sm:flex-row">
          <SeoPanel
            title="Before (Current Site)"
            data={seoBefore}
            url={lead?.website_url || ''}
            onFetch={() => fetchSeo('before')}
            fetching={scanningBefore}
            fetchedAt={seoBeforeAt}
          />
          <SeoPanel
            title="After (New Site)"
            data={seoAfter}
            url={afterUrl}
            onFetch={() => fetchSeo('after')}
            fetching={scanningAfter}
            fetchedAt={seoAfterAt}
          />
        </div>
      </div>

      <BeforeAfterViewTab lead={lead} comparison={comparison} metrics={metrics} />
    </div>
  )
}
