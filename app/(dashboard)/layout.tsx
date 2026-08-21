import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/auth'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { PwaRegister } from '@/components/pwa/PwaRegister'
import { NotificationToaster } from '@/components/notifications/NotificationToaster'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Verified locally and memoized for the request, so the page rendering inside
  // this layout reuses the result instead of paying a second auth round-trip.
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <>
      <PwaRegister />
      <NotificationToaster userId={user.id} />
      <DashboardShell userId={user.id}>{children}</DashboardShell>
    </>
  )
}
