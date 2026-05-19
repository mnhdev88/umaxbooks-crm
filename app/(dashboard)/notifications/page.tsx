import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { Profile, Notification } from '@/types'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export default async function NotificationsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()
  if (!profile) redirect('/login')

  const isAdmin = profile.role === 'admin'

  let notifications: Notification[] = []

  if (isAdmin) {
    // Admins see all notifications with recipient info
    const { data } = await supabase
      .from('notifications')
      .select('*, user:profiles!notifications_user_id_fkey(full_name, role)')
      .order('created_at', { ascending: false })
      .limit(150)
    notifications = (data ?? []) as Notification[]
  } else {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    notifications = (data ?? []) as Notification[]
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#07061A]">
      <Header title="Notifications" profile={profile as Profile} />
      <NotificationsClient
        initialNotifications={notifications}
        userId={user.id}
        isAdmin={isAdmin}
      />
    </div>
  )
}
