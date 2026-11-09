import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { fetchEmailConversations } from '@/lib/email-conversations'
import { EmailInboxClient } from '@/components/email/EmailInboxClient'

/**
 * /emails — every lead email conversation in one inbox: mail sent from the CRM, mail
 * agents sent from Gmail and lead replies (synced from Google Workspace). Scoped like
 * the Email Status page; see lib/email-conversations.ts.
 */
export default async function EmailsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')
  if (['developer', 'client', 'seo_agent'].includes(profile.role)) redirect('/')

  const showAgentFilter = profile.role === 'admin' || profile.role === 'sales_manager'
  const [conversations, { data: agents }] = await Promise.all([
    fetchEmailConversations(supabase, { userId: user.id, role: profile.role }),
    showAgentFilter
      ? supabase
          .from('profiles')
          .select('id, full_name')
          .in('role', ['admin', 'agent', 'sales_agent', 'sales_manager'])
          .order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ])

  return (
    <>
      <Header title="Emails" profile={profile as Profile} />
      <EmailInboxClient
        initialConversations={conversations}
        userId={user.id}
        agents={(agents || []) as { id: string; full_name: string }[]}
      />
    </>
  )
}
