import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { SeoSiteClient } from '@/components/seo/SeoSiteClient'

interface PageProps {
  params: Promise<{ siteId: string }>
}

// One client site: score history, the open issue queue, the month's tasks, and
// the settings that drive monitoring and reporting.

export default async function SeoSitePage({ params }: PageProps) {
  const { siteId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && profile.role !== 'seo_agent') redirect('/')

  const { data: site, error } = await supabase
    .from('live_sites')
    .select(`
      id, lead_id, final_url, go_live_date, last_seo_check_at,
      seo_plan, seo_check_frequency, seo_started_at, seo_auto_report, seo_report_email,
      target_keywords, gsc_property, gbp_url, assigned_seo_agent_id,
      domain_expiry, ssl_expiry, hosting_expiry,
      leads(id, name, company_name, email)
    `)
    .eq('id', siteId)
    .maybeSingle()

  if (error) console.error('[seo site] query failed:', error.message)
  if (!site) notFound()

  const [{ data: checks }, { data: issues }, { data: tasks }, { data: reports }] = await Promise.all([
    supabase
      .from('seo_checks')
      .select('id, ran_at, source, onpage_score, psi_seo, psi_perf, psi_a11y, cms, onpage, error')
      .eq('site_id', siteId)
      .order('ran_at', { ascending: false })
      .limit(12),
    supabase
      .from('seo_issues')
      .select('id, check_key, label, severity, detail, impact, status, first_seen_at, fixed_at, auto_fixed, notes')
      .eq('site_id', siteId)
      .order('status', { ascending: true })
      .order('severity', { ascending: true })
      .order('first_seen_at', { ascending: true }),
    supabase
      .from('seo_tasks')
      .select('id, title, category, status, due_date, completed_at, notes, created_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: false }),
    supabase
      .from('seo_reports')
      .select('id, period_start, period_end, status, sent_at, sent_to')
      .eq('site_id', siteId)
      .order('period_start', { ascending: false })
      .limit(6),
  ])

  const lead = Array.isArray((site as any).leads) ? (site as any).leads[0] : (site as any).leads

  return (
    <>
      <Header title={lead?.company_name ?? lead?.name ?? 'Site'} profile={profile as Profile} />
      <SeoSiteClient
        site={{ ...(site as any), leads: lead }}
        checks={(checks ?? []) as any[]}
        issues={(issues ?? []) as any[]}
        tasks={(tasks ?? []) as any[]}
        reports={(reports ?? []) as any[]}
        isAdmin={isAdmin}
      />
    </>
  )
}
