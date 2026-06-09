import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { AICallsClient, VoiceCallWithLead } from '@/components/voice/AICallsClient'

export default async function AICallsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  if (!profile) redirect('/login')

  // Sales agents only see calls for leads assigned to them (mirrors Email Status scoping).
  let leadIdFilter: string[] | null = null
  if (profile.role === 'sales_agent') {
    const { data: assignedLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('assigned_agent_id', user.id)
    leadIdFilter = (assignedLeads || []).map((l: any) => l.id)
  }

  if (leadIdFilter !== null && leadIdFilter.length === 0) {
    return (
      <>
        <Header title="AI Calls" profile={profile as Profile} />
        <AICallsClient initialCalls={[]} />
      </>
    )
  }

  let query = supabase
    .from('voice_calls')
    .select(`
      *,
      lead:leads(id, name, company_name, lead_number, phone)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (leadIdFilter !== null) {
    query = query.in('lead_id', leadIdFilter)
  }

  const { data: calls } = await query

  return (
    <>
      <Header title="AI Calls" profile={profile as Profile} />
      <AICallsClient initialCalls={(calls || []) as VoiceCallWithLead[]} />
    </>
  )
}
