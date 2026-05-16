import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalShell } from '@/components/portal/PortalShell'
import { Profile } from '@/types'
import { getPortalLeadId } from '@/lib/portal-context'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  if (!profile) redirect('/login')

  const { isAdminPreview, leadId } = await getPortalLeadId()

  // Staff without a preview cookie → back to dashboard (middleware already blocks this,
  // but double-check here for safety)
  if (profile.role !== 'client' && !isAdminPreview) redirect('/')

  return (
    <PortalShell profile={profile as Profile} isAdminPreview={isAdminPreview}>
      {children}
    </PortalShell>
  )
}
