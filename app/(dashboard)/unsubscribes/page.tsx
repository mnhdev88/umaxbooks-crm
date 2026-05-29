import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { UnsubscribesClient } from '@/components/email/UnsubscribesClient'

export default async function UnsubscribesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const { data: leads } = await supabase
    .from('leads')
    .select('id, lead_number, company_name, email, email_unsubscribed_at')
    .eq('email_unsubscribed', true)
    .order('email_unsubscribed_at', { ascending: false })

  return (
    <>
      <Header title="Unsubscribes" profile={profile as Profile} />
      <div className="p-6">
        <UnsubscribesClient initialLeads={leads || []} />
      </div>
    </>
  )
}
