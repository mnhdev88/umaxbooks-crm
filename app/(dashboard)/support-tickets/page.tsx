import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { SupportTicketsClient } from '@/components/support/SupportTicketsClient'

export default async function SupportTicketsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'sales_agent'].includes(profile.role)) {
    redirect('/')
  }

  const { data: tickets } = await supabase
    .from('support_requests')
    .select(`
      *,
      lead:leads(id, name, company_name, phone, email),
      client:profiles!support_requests_client_id_fkey(full_name, email)
    `)
    .order('created_at', { ascending: false })

  return (
    <>
      <Header title="Support Tickets" profile={profile as Profile} />
      <SupportTicketsClient
        initialTickets={(tickets || []) as any[]}
        profile={profile as Profile}
      />
    </>
  )
}
