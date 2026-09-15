/**
 * Run an SEO check on a live site and reconcile its issue queue.
 *
 * This is the piece that turns a crawl into work: a raw JSON blob is something
 * nobody reads twice, so every failed/warned check becomes a row in seo_issues
 * that stays open until the site actually passes it again. The monthly report
 * is then just "which issues closed this period", which is exactly the question
 * the client is paying us to answer.
 *
 * Takes the Supabase client as an argument so the manual "Run check now" button
 * runs under the user's RLS, while the cron passes a service client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { auditUrl } from '@/lib/seo/crawl'
import { fetchPageSpeed } from '@/lib/seo/psi'

export interface SeoCheckSite {
  id: string
  lead_id: string
  final_url: string | null
}

export interface RunCheckResult {
  ok: boolean
  checkId: string | null
  /** On-page score 0-100, null when the crawl failed. */
  score: number | null
  newIssues: number
  fixedIssues: number
  error: string | null
}

/**
 * Crawl one site, store the snapshot, and open/close issues against it.
 *
 * Never throws for an unreachable site — a dead client site is a finding, not a
 * crash. It records a seo_checks row carrying `error` and leaves the existing
 * issue queue untouched (we can't tell what got fixed if we can't see the page).
 */
export async function runSeoCheck(
  supabase: SupabaseClient,
  site: SeoCheckSite,
  opts: { source: 'manual' | 'auto'; ranBy?: string | null } = { source: 'manual' }
): Promise<RunCheckResult> {
  const url = (site.final_url ?? '').trim()
  if (!url) {
    return { ok: false, checkId: null, score: null, newIssues: 0, fixedIssues: 0, error: 'No final URL on this site' }
  }

  // PSI is the optional half: it's slow, rate-limited, and unavailable without a
  // key. Losing it costs us three numbers; losing the crawl costs us the check.
  const [crawlOutcome, psiOutcome] = await Promise.allSettled([
    auditUrl(url),
    fetchPageSpeed(url),
  ])

  const psi = psiOutcome.status === 'fulfilled' ? psiOutcome.value : null
  if (psiOutcome.status === 'rejected') {
    console.warn('[seo-check] PSI unavailable for', url, '-', psiOutcome.reason?.message)
  }

  if (crawlOutcome.status === 'rejected') {
    const message = crawlOutcome.reason?.message || 'Crawl failed'
    const { data } = await supabase
      .from('seo_checks')
      .insert({
        site_id: site.id,
        lead_id: site.lead_id,
        url,
        source: opts.source,
        ran_by: opts.ranBy ?? null,
        psi_seo:  psi?.scores.seo          ?? null,
        psi_perf: psi?.scores.performance  ?? null,
        psi_a11y: psi?.scores.accessibility ?? null,
        psi,
        error: message,
      })
      .select('id')
      .single()

    await touchSite(supabase, site.id)
    return { ok: false, checkId: data?.id ?? null, score: null, newIssues: 0, fixedIssues: 0, error: message }
  }

  const crawl = crawlOutcome.value

  const { data: check, error: insertError } = await supabase
    .from('seo_checks')
    .insert({
      site_id: site.id,
      lead_id: site.lead_id,
      url: crawl.url,
      source: opts.source,
      ran_by: opts.ranBy ?? null,
      onpage_score: crawl.score,
      psi_seo:  psi?.scores.seo           ?? null,
      psi_perf: psi?.scores.performance   ?? null,
      psi_a11y: psi?.scores.accessibility ?? null,
      cms: crawl.cms,
      onpage: crawl,
      psi,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[seo-check] could not store check for', url, insertError.message)
    return { ok: false, checkId: null, score: crawl.score, newIssues: 0, fixedIssues: 0, error: insertError.message }
  }

  const { newIssues, fixedIssues } = await reconcileIssues(supabase, site, crawl)
  await touchSite(supabase, site.id)

  return { ok: true, checkId: check.id, score: crawl.score, newIssues, fixedIssues, error: null }
}

/** Open issues for what's failing now, close the ones that started passing. */
async function reconcileIssues(
  supabase: SupabaseClient,
  site: SeoCheckSite,
  crawl: Awaited<ReturnType<typeof auditUrl>>
): Promise<{ newIssues: number; fixedIssues: number }> {
  const failing = crawl.checks.filter(c => c.status === 'fail' || c.status === 'warn')
  const failingByKey = new Map(failing.map(c => [c.key, c]))

  const { data: openRows } = await supabase
    .from('seo_issues')
    .select('id, check_key, severity')
    .eq('site_id', site.id)
    .eq('status', 'open')

  const open = openRows ?? []
  const openKeys = new Set(open.map((r: any) => r.check_key))

  // Anything failing that has no open issue yet.
  const toOpen = failing.filter(c => !openKeys.has(c.key))
  if (toOpen.length) {
    const { error } = await supabase.from('seo_issues').insert(
      toOpen.map(c => ({
        site_id: site.id,
        lead_id: site.lead_id,
        check_key: c.key,
        label: c.label,
        severity: c.status,          // 'fail' | 'warn'
        detail: c.value,
        impact: c.impact,
      }))
    )
    // A unique-violation here means a concurrent run beat us to it — harmless.
    if (error && !/duplicate key/i.test(error.message)) {
      console.error('[seo-check] could not open issues:', error.message)
    }
  }

  // Anything open that the crawl no longer flags — the site now passes it.
  const toFix = open.filter((r: any) => !failingByKey.has(r.check_key))
  if (toFix.length) {
    const { error } = await supabase
      .from('seo_issues')
      .update({ status: 'fixed', fixed_at: new Date().toISOString(), auto_fixed: true, updated_at: new Date().toISOString() })
      .in('id', toFix.map((r: any) => r.id))
    if (error) console.error('[seo-check] could not close issues:', error.message)
  }

  // A warn that decayed into a fail (or vice versa) should show its current weight.
  for (const row of open as any[]) {
    const current = failingByKey.get(row.check_key)
    if (current && current.status !== row.severity) {
      await supabase
        .from('seo_issues')
        .update({ severity: current.status, detail: current.value, updated_at: new Date().toISOString() })
        .eq('id', row.id)
    }
  }

  return { newIssues: toOpen.length, fixedIssues: toFix.length }
}

async function touchSite(supabase: SupabaseClient, siteId: string) {
  await supabase
    .from('live_sites')
    .update({ last_seo_check_at: new Date().toISOString() })
    .eq('id', siteId)
}
