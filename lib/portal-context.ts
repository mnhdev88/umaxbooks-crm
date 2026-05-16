import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export const PREVIEW_COOKIE = 'portal_preview_lead_id'

/**
 * Returns the lead_id to use in portal pages.
 * - Client users: their own profile.lead_id
 * - Admin users in preview mode: lead_id from the preview cookie set by /api/portal-preview
 */
export async function getPortalLeadId(): Promise<{
  leadId: string | null
  isAdminPreview: boolean
  role: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { leadId: null, isAdminPreview: false, role: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, lead_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { leadId: null, isAdminPreview: false, role: null }

  if (profile.role === 'client') {
    return { leadId: profile.lead_id ?? null, isAdminPreview: false, role: 'client' }
  }

  // Admin preview mode — read lead_id from cookie
  if (['admin', 'agent', 'sales_agent', 'developer'].includes(profile.role)) {
    const cookieStore = await cookies()
    const previewLeadId = cookieStore.get(PREVIEW_COOKIE)?.value ?? null
    return { leadId: previewLeadId, isAdminPreview: true, role: profile.role }
  }

  return { leadId: null, isAdminPreview: false, role: profile.role }
}
