import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Lead, Profile } from '@/types'
import { LeadsPageClient } from '@/components/leads/LeadsPageClient'

export default async function LeadsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()

  const { data: leads } = await supabase
    .from('leads')
    .select('*, assigned_agent:profiles!leads_assigned_agent_id_fkey(full_name)')
    .order('created_at', { ascending: false })

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])
    .order('full_name')

  return (
    <>
      <Header title="Lead Management" profile={profile as Profile} />
      <LeadsPageClient
        initialLeads={(leads || []) as Lead[]}
        agents={(agents || []) as Profile[]}
        profile={profile as Profile}
        userId={user.id}
      />
    </>
  )
}
