import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { PwaRegister } from '@/components/pwa/PwaRegister'
import { NotificationToaster } from '@/components/notifications/NotificationToaster'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <>
      <PwaRegister />
      <NotificationToaster userId={user.id} />
      <DashboardShell userId={user.id}>{children}</DashboardShell>
    </>
  )
}
