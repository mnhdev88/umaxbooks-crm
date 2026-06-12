import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { CareersClient } from '@/components/careers/CareersClient'

export default async function CareersPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/')

  const [{ data: jobs }, { data: applications }] = await Promise.all([
    supabase
      .from('job_postings')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabase
      .from('job_applications')
      .select('*')
      .order('created_at', { ascending: false }),
  ])

  return (
    <>
      <Header title="Careers" profile={profile as Profile} />
      <div className="p-6">
        <CareersClient initialJobs={jobs || []} initialApplications={applications || []} />
      </div>
    </>
  )
}
