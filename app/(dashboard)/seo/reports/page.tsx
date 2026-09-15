import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { SeoReportsClient } from '@/components/seo/SeoReportsClient'

// Client Reports — drafts waiting for a human sentence, and the archive of what
// has already gone out. The numbers are already assembled by the time a report
// lands here; the agent's job is the commentary and the Send.

export default async function SeoReportsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'
  if (!isAdmin && profile.role !== 'seo_agent') redirect('/')

  // RLS already limits an SEO agent to their own sites; admins see everything.
  const { data: reports, error } = await supabase
    .from('seo_reports')
    .select(`
      id, site_id, lead_id, period_start, period_end, data, commentary,
      status, sent_at, sent_to, generated_by, created_at,
      live_sites(final_url, seo_report_email, leads(company_name, name, email))
    `)
    .order('status', { ascending: true })
    .order('period_start', { ascending: false })
    .limit(60)

  if (error) console.error('[seo reports] query failed:', error.message)

  const rows = (reports ?? []).map((r: any) => {
    const site = Array.isArray(r.live_sites) ? r.live_sites[0] : r.live_sites
    const lead = site ? (Array.isArray(site.leads) ? site.leads[0] : site.leads) : null
    return {
      ...r,
      site_url: site?.final_url ?? null,
      // The dedicated reporting contact wins over the sales contact, matching
      // what the send route will actually do.
      default_to: site?.seo_report_email ?? lead?.email ?? null,
      business: lead?.company_name ?? lead?.name ?? 'Client',
    }
  })

  return (
    <>
      <Header title="Client Reports" profile={profile as Profile} />
      <SeoReportsClient rows={rows} />
    </>
  )
}
