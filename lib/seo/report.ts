/**
 * Monthly client SEO report — assembly only.
 *
 * Everything here is pulled from rows the CRM already has: the checks the
 * monitor ran, the issues that closed, the tasks the agent completed. Nobody
 * types a number twice, and because the result is frozen into seo_reports.data
 * a report that went out in March still says what it said in March.
 *
 * Rendering (email HTML, PDF) lives in lib/seo/report-render.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReportScores {
  onpage: number | null
  psiSeo: number | null
  psiPerf: number | null
  psiA11y: number | null
}

export interface SeoReportData {
  business: string
  contactName: string | null
  url: string
  periodLabel: string
  periodStart: string
  periodEnd: string
  checksRun: number
  current: ReportScores | null
  previous: ReportScores | null
  fixed: { label: string; impact: string | null; fixedAt: string | null }[]
  open: { label: string; severity: string; impact: string | null; sinceDays: number }[]
  tasks: { title: string; category: string; completedAt: string | null }[]
  health: { domainExpiry: string | null; sslExpiry: string | null; hostingExpiry: string | null }
}

/** Month containing `ref`, as the [start, end] a report covers. */
export function monthBounds(ref: Date): { start: string; end: string; label: string } {
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1))
  const end   = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0))
  return {
    start: start.toISOString().slice(0, 10),
    end:   end.toISOString().slice(0, 10),
    label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

/** The month before the one containing `ref` — what the 1st-of-month cron reports on. */
export function previousMonthBounds(ref: Date) {
  return monthBounds(new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - 1, 1)))
}

function scoresOf(row: any): ReportScores | null {
  if (!row) return null
  return {
    onpage:  row.onpage_score ?? null,
    psiSeo:  row.psi_seo      ?? null,
    psiPerf: row.psi_perf     ?? null,
    psiA11y: row.psi_a11y     ?? null,
  }
}

function daysSince(iso: string | null): number {
  if (!iso) return 0
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/**
 * Gather everything the report shows for one site over one period.
 * Returns null when the site has no usable record at all (no check ever run).
 */
export async function buildReportData(
  supabase: SupabaseClient,
  siteId: string,
  periodStart: string,
  periodEnd: string
): Promise<SeoReportData | null> {
  const { data: site } = await supabase
    .from('live_sites')
    .select('id, lead_id, final_url, domain_expiry, ssl_expiry, hosting_expiry, leads(name, company_name)')
    .eq('id', siteId)
    .single()

  if (!site) return null

  const lead = Array.isArray((site as any).leads) ? (site as any).leads[0] : (site as any).leads

  // Period is inclusive of both dates; end-of-day so a check run on the 31st counts.
  const fromIso = `${periodStart}T00:00:00.000Z`
  const toIso   = `${periodEnd}T23:59:59.999Z`

  const [{ data: periodChecks }, { data: priorCheck }, { data: fixed }, { data: open }, { data: tasks }] =
    await Promise.all([
      supabase
        .from('seo_checks')
        .select('onpage_score, psi_seo, psi_perf, psi_a11y, ran_at')
        .eq('site_id', siteId)
        .is('error', null)
        .gte('ran_at', fromIso)
        .lte('ran_at', toIso)
        .order('ran_at', { ascending: false }),
      supabase
        .from('seo_checks')
        .select('onpage_score, psi_seo, psi_perf, psi_a11y, ran_at')
        .eq('site_id', siteId)
        .is('error', null)
        .lt('ran_at', fromIso)
        .order('ran_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('seo_issues')
        .select('label, impact, fixed_at')
        .eq('site_id', siteId)
        .eq('status', 'fixed')
        .gte('fixed_at', fromIso)
        .lte('fixed_at', toIso)
        .order('fixed_at', { ascending: true }),
      supabase
        .from('seo_issues')
        .select('label, impact, severity, first_seen_at')
        .eq('site_id', siteId)
        .eq('status', 'open')
        .order('severity', { ascending: true }),
      supabase
        .from('seo_tasks')
        .select('title, category, completed_at')
        .eq('site_id', siteId)
        .eq('status', 'done')
        .gte('completed_at', fromIso)
        .lte('completed_at', toIso)
        .order('completed_at', { ascending: true }),
    ])

  const checks = periodChecks ?? []

  return {
    business: lead?.company_name ?? lead?.name ?? 'Your website',
    contactName: lead?.name ?? null,
    url: (site as any).final_url ?? '',
    periodLabel: new Date(`${periodStart}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }),
    periodStart,
    periodEnd,
    checksRun: checks.length,
    current: scoresOf(checks[0]),
    // Compare against the last check of the previous period when we have one,
    // otherwise the earliest check inside this period — a first month still
    // shows movement rather than a row of dashes.
    previous: scoresOf(priorCheck) ?? scoresOf(checks.length > 1 ? checks[checks.length - 1] : null),
    fixed: (fixed ?? []).map((r: any) => ({ label: r.label, impact: r.impact, fixedAt: r.fixed_at })),
    open: (open ?? []).map((r: any) => ({
      label: r.label,
      severity: r.severity,
      impact: r.impact,
      sinceDays: daysSince(r.first_seen_at),
    })),
    tasks: (tasks ?? []).map((r: any) => ({ title: r.title, category: r.category, completedAt: r.completed_at })),
    health: {
      domainExpiry:  (site as any).domain_expiry  ?? null,
      sslExpiry:     (site as any).ssl_expiry     ?? null,
      hostingExpiry: (site as any).hosting_expiry ?? null,
    },
  }
}

/**
 * Create (or refresh) the draft report for a period.
 *
 * Re-running is safe: a draft is overwritten with fresh numbers, a report that
 * has already been SENT is never touched.
 */
export async function upsertDraftReport(
  supabase: SupabaseClient,
  site: { id: string; lead_id: string },
  periodStart: string,
  periodEnd: string,
  generatedBy: 'auto' | 'manual'
): Promise<{ id: string; status: string; created: boolean } | null> {
  const { data: existing } = await supabase
    .from('seo_reports')
    .select('id, status')
    .eq('site_id', site.id)
    .eq('period_start', periodStart)
    .maybeSingle()

  if (existing?.status === 'sent') return { id: existing.id, status: 'sent', created: false }

  const data = await buildReportData(supabase, site.id, periodStart, periodEnd)
  if (!data) return null

  if (existing) {
    const { error } = await supabase
      .from('seo_reports')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (error) { console.error('[seo-report] refresh failed:', error.message); return null }
    return { id: existing.id, status: 'draft', created: false }
  }

  const { data: inserted, error } = await supabase
    .from('seo_reports')
    .insert({
      site_id: site.id,
      lead_id: site.lead_id,
      period_start: periodStart,
      period_end: periodEnd,
      data,
      generated_by: generatedBy,
    })
    .select('id')
    .single()

  if (error) { console.error('[seo-report] create failed:', error.message); return null }
  return { id: inserted.id, status: 'draft', created: true }
}
