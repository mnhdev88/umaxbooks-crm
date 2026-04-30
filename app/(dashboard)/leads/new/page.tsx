import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { LeadForm } from '@/components/leads/LeadForm'
import { Profile } from '@/types'

export default async function NewLeadPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role === 'developer') redirect('/')

  const { data: agents } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['agent', 'sales_agent', 'admin'])

  return (
    <>
      <Header title="New Lead" profile={profile as Profile} />
      <div className="p-6 max-w-3xl">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <LeadForm
            agents={(agents || []) as Profile[]}
            userId={user.id}
          />
        </div>
      </div>
    </>
  )
}
