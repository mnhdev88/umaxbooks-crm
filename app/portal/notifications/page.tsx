import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Notification } from '@/types'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export default async function PortalNotificationsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const notifications = (data ?? []) as Notification[]

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-slate-800 px-6 py-4">
        <h2 className="text-lg font-semibold text-white">Notifications</h2>
        <p className="text-slate-400 text-sm">Updates about your project</p>
      </div>
      <NotificationsClient
        initialNotifications={notifications}
        userId={user.id}
        isAdmin={false}
      />
    </div>
  )
}
