import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { runSeoCheck } from '@/lib/seo/check'

/**
 * Sweeps every live site on an SEO plan whose next check is due, and notifies
 * the assigned agent about what changed.
 *
 * This is the whole point of the role: nobody opens 40 client sites by hand
 * every month. The agent gets told "this site lost its meta description and
 * dropped 14 points" and goes and fixes it.
 *
 * Schedule (server crontab on the VPS — vercel.json crons don't fire on PM2):
 *   0 3 * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/seo-monitor
 *
 * Runs daily but only checks what's actually due, so weekly and monthly sites
 * can share one schedule.
 */

export const maxDuration = 300

/** Sites are crawled one at a time — PSI rate-limits hard on parallel requests. */
const MAX_PER_RUN = 25

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: sites, error } = await supabase
    .from('live_sites')
    .select('id, lead_id, final_url, seo_check_frequency, last_seo_check_at, assigned_seo_agent_id, leads(company_name, name)')
    .neq('seo_plan', 'none')
    .not('final_url', 'is', null)
    .order('last_seo_check_at', { ascending: true, nullsFirst: true })

  if (error) {
    console.error('[seo-monitor] could not load sites:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const due = (sites ?? []).filter((s: any) => {
    if (!s.last_seo_check_at) return true          // never checked
    const days = (now - new Date(s.last_seo_check_at).getTime()) / 86_400_000
    return days >= (s.seo_check_frequency === 'weekly' ? 7 : 30)
  }).slice(0, MAX_PER_RUN)

  const results: any[] = []

  for (const site of due as any[]) {
    const lead = Array.isArray(site.leads) ? site.leads[0] : site.leads
    const name = lead?.company_name ?? lead?.name ?? 'A client site'

    const result = await runSeoCheck(supabase, site, { source: 'auto' })
    results.push({ site: name, ...result })

    if (!site.assigned_seo_agent_id) continue

    // Only interrupt the agent when something actually changed. A clean check
    // that found nothing new is exactly the notification people learn to ignore.
    if (!result.ok) {
      await notify(supabase, site.assigned_seo_agent_id, site.lead_id,
        `SEO check failed — ${name}`,
        `We couldn't crawl ${site.final_url}. ${result.error ?? ''}`.trim(),
        'warning')
    } else if (result.newIssues > 0) {
      await notify(supabase, site.assigned_seo_agent_id, site.lead_id,
        `${result.newIssues} new SEO issue${result.newIssues === 1 ? '' : 's'} — ${name}`,
        `Score is ${result.score}/100. ${result.newIssues} new issue${result.newIssues === 1 ? '' : 's'} opened${result.fixedIssues ? `, ${result.fixedIssues} closed` : ''}.`,
        'warning')
    } else if (result.fixedIssues > 0) {
      await notify(supabase, site.assigned_seo_agent_id, site.lead_id,
        `${result.fixedIssues} SEO issue${result.fixedIssues === 1 ? '' : 's'} resolved — ${name}`,
        `Score is now ${result.score}/100.`,
        'success')
    }
  }

  console.log(`[seo-monitor] checked ${results.length} of ${sites?.length ?? 0} sites`)
  return NextResponse.json({ checked: results.length, results })
}

async function notify(
  supabase: any,
  userId: string,
  leadId: string,
  title: string,
  message: string,
  type: string
) {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId, lead_id: leadId, title, message, type,
  })
  if (error) console.error('[seo-monitor] notify failed:', error.message)
}
