import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { UserManagement } from '@/components/settings/UserManagement'

export default async function SettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/')

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })

  return (
    <>
      <Header title="Settings" profile={profile as Profile} />
      <div className="p-6 max-w-3xl space-y-6">
        <UserManagement users={(users || []) as Profile[]} currentUserId={user.id} />
      </div>
    </>
  )
}
