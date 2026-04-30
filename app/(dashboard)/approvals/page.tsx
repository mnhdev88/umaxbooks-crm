import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { ApprovalsClient } from '@/components/admin/ApprovalsClient'

export default async function ApprovalsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/')

  const { data: approvals } = await supabase
    .from('project_approvals')
    .select(`
      *,
      lead:leads(id, company_name, name, website_url, gmb_url, city, status, slug, assigned_agent_id)
    `)
    .order('created_at', { ascending: false })

  const { data: salesAgents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['sales_agent', 'admin'])
    .order('full_name')

  return (
    <>
      <Header title="Demo Approvals" profile={profile as Profile} />
      <ApprovalsClient
        initialApprovals={(approvals || []) as any[]}
        salesAgents={(salesAgents || []) as Profile[]}
        userId={user.id}
      />
    </>
  )
}
