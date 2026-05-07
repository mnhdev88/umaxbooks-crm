import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile } from '@/types'
import { ProfileSettings } from '@/components/profile/ProfileSettings'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  return (
    <>
      <Header title="My Profile" profile={profile as Profile} />
      <div className="p-6 max-w-lg">
        <ProfileSettings profile={profile as Profile} />
      </div>
    </>
  )
}
