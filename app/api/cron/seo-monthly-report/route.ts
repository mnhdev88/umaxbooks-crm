import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { previousMonthBounds, upsertDraftReport } from '@/lib/seo/report'
import { sendSeoReport } from '@/lib/seo/send-report'
import { automatedEmailEnabled } from '@/lib/automated-email'

/**
 * Monthly client reporting, in two halves.
 *
 *  1. DRAFT — on the first few days of each month, build last month's report for
 *     every site on an SEO plan and tell the assigned agent it's waiting. The
 *     numbers are already filled in; the agent adds a couple of sentences and
 *     presses Send. Two minutes per client instead of an hour.
 *
 *  2. AUTO-SEND — for sites explicitly opted in (live_sites.seo_auto_report),
 *     a draft nobody reviewed within GRACE_DAYS goes out on its own.
 *
 * The grace window is the point. A report can carry bad news — a score that
 * fell, a client's own web guy stripping the meta tags — and that should reach
 * the client with a human sentence attached. This gives the agent a few days to
 * write one, without the report silently never going out if they don't.
 *
 * Schedule (server crontab on the VPS — vercel.json crons don't fire on PM2):
 *   30 6 * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/seo-monthly-report
 *
 * Runs daily; drafting only happens early in the month, the send sweep every day.
 */

export const maxDuration = 300

/** Days a draft waits for a human before an opted-in site sends it anyway. */
const GRACE_DAYS = 3
/** Drafting re-runs on these days of the month, so one failed night isn't fatal. */
const DRAFT_DAYS = [1, 2, 3]

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now = new Date()
  const period = previousMonthBounds(now)
  let drafted = 0

  // ── 1. Draft last month's reports ────────────────────────────────────────
  if (DRAFT_DAYS.includes(now.getUTCDate())) {
    const { data: sites } = await supabase
      .from('live_sites')
      .select('id, lead_id, assigned_seo_agent_id, leads(company_name, name)')
      .neq('seo_plan', 'none')
      .not('final_url', 'is', null)

    for (const site of (sites ?? []) as any[]) {
      const result = await upsertDraftReport(supabase, site, period.start, period.end, 'auto')
      if (!result || result.status === 'sent') continue
      if (!result.created) continue            // already drafted; don't re-notify

      drafted++
      if (!site.assigned_seo_agent_id) continue

      const lead = Array.isArray(site.leads) ? site.leads[0] : site.leads
      const name = lead?.company_name ?? lead?.name ?? 'a client'

      await supabase.from('notifications').insert({
        user_id: site.assigned_seo_agent_id,
        lead_id: site.lead_id,
        title: `SEO report ready to review — ${name}`,
        message: `${period.label}'s report is drafted. Add your notes and send it.`,
        type: 'info',
      })
    }
  }

  // ── 2. Auto-send drafts nobody reviewed ──────────────────────────────────
  // Unattended email, so the global kill switch applies here — unlike the Send
  // button, which a person is standing behind.
  let sent = 0
  const skipped: string[] = []

  if (await automatedEmailEnabled()) {
    const cutoff = new Date(now.getTime() - GRACE_DAYS * 86_400_000).toISOString()

    const { data: drafts } = await supabase
      .from('seo_reports')
      .select('id, site_id, created_at, live_sites!inner(seo_auto_report)')
      .eq('status', 'draft')
      .lte('created_at', cutoff)
      .eq('live_sites.seo_auto_report', true)

    for (const draft of (drafts ?? []) as any[]) {
      const result = await sendSeoReport(supabase, draft.id)
      if (result.ok) sent++
      else skipped.push(`${draft.id}: ${result.error}`)
    }
  } else {
    console.log('[seo-monthly-report] automated email is off — drafts held for manual send')
  }

  console.log(`[seo-monthly-report] drafted ${drafted}, auto-sent ${sent}`)
  return NextResponse.json({ period: period.label, drafted, sent, skipped })
}
