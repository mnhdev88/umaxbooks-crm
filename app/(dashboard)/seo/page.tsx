import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { SeoBoardClient } from '@/components/seo/SeoBoardClient'

// Site Health — the SEO agent's queue. One card per live client site, worst
// first, so the sites that need attention are the ones you see.
//
// Admins see every site (including ones nobody is assigned to yet, which is the
// signal to assign someone); an SEO agent sees only their own.

export default async function SeoBoardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && profile.role !== 'seo_agent') redirect('/')

  let query = supabase
    .from('live_sites')
    .select(`
      id, lead_id, final_url, go_live_date, last_seo_check_at,
      seo_plan, seo_check_frequency, assigned_seo_agent_id,
      domain_expiry, ssl_expiry,
      leads(id, name, company_name, email),
      seo_agent:profiles!live_sites_assigned_seo_agent_id_fkey(id, full_name)
    `)
    .not('final_url', 'is', null)

  if (!isAdmin) query = query.eq('assigned_seo_agent_id', user.id)

  const { data: sites, error } = await query

  // A failed select renders as "no sites" otherwise, which reads exactly like a
  // correct empty state — see the migration-drift note in the repo docs.
  if (error) console.error('[seo board] site query failed:', error.message)

  const siteIds = (sites ?? []).map((s: any) => s.id)

  const [{ data: openIssues }, { data: latestChecks }, { data: seoAgents }] = await Promise.all([
    siteIds.length
      ? supabase.from('seo_issues').select('site_id, severity').in('site_id', siteIds).eq('status', 'open')
      : Promise.resolve({ data: [] as any[] }),
    siteIds.length
      ? supabase
          .from('seo_checks')
          .select('site_id, onpage_score, psi_seo, psi_perf, ran_at, error')
          .in('site_id', siteIds)
          .order('ran_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    isAdmin
      ? supabase.from('profiles').select('id, full_name').eq('role', 'seo_agent').order('full_name')
      : Promise.resolve({ data: [] as any[] }),
  ])

  // First row per site wins — the list is already newest-first.
  const latestBySite = new Map<string, any>()
  for (const c of (latestChecks ?? []) as any[]) {
    if (!latestBySite.has(c.site_id)) latestBySite.set(c.site_id, c)
  }

  const issueCounts = new Map<string, { open: number; fail: number }>()
  for (const i of (openIssues ?? []) as any[]) {
    const entry = issueCounts.get(i.site_id) ?? { open: 0, fail: 0 }
    entry.open++
    if (i.severity === 'fail') entry.fail++
    issueCounts.set(i.site_id, entry)
  }

  const rows = (sites ?? []).map((s: any) => ({
    ...s,
    leads: Array.isArray(s.leads) ? s.leads[0] ?? null : s.leads,
    seo_agent: Array.isArray(s.seo_agent) ? s.seo_agent[0] ?? null : s.seo_agent,
    latest: latestBySite.get(s.id) ?? null,
    issues: issueCounts.get(s.id) ?? { open: 0, fail: 0 },
  }))

  return (
    <>
      <Header title="Site Health" profile={profile as Profile} />
      <SeoBoardClient
        rows={rows}
        isAdmin={isAdmin}
        seoAgents={(seoAgents ?? []) as { id: string; full_name: string }[]}
      />
    </>
  )
}
