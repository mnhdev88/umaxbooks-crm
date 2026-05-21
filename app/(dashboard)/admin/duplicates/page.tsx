import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { DuplicateLeadsManager } from '@/components/admin/DuplicateLeadsManager'

export default async function DuplicatesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Admin only
  if (profile?.role !== 'admin') {
    redirect('/')
  }

  return (
    <>
      <Header title="Duplicate Leads Manager" profile={profile as Profile} />
      <div className="max-w-6xl mx-auto px-6 py-8">
        <DuplicateLeadsManager />
      </div>
    </>
  )
}
