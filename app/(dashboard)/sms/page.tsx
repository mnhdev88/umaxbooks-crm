import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { fetchSmsConversations } from '@/lib/sms-conversations'
import { SmsInboxClient } from '@/components/sms/SmsInboxClient'

/**
 * /sms — global SMS inbox. Lists every lead conversation (newest first) with the thread
 * open beside it. SMS is a sales/comms tool, so developers and clients are redirected out;
 * sales agents see only their own leads' conversations (scoped in fetchSmsConversations).
 */
export default async function SmsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')
  if (profile.role === 'developer' || profile.role === 'client') redirect('/')

  const conversations = await fetchSmsConversations(supabase, {
    userId: user.id,
    role: profile.role,
  })

  return (
    <>
      <Header title="SMS" profile={profile as Profile} />
      <SmsInboxClient initialConversations={conversations} />
    </>
  )
}
