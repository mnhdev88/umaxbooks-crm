/**
 * Shared auth guard for the /api/seo/* routes.
 *
 * RLS is the real boundary — every policy in migration 111 already restricts an
 * SEO agent to their own sites. This just fails fast with a clear status code
 * instead of letting a wrong-role caller get a silent empty result.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/supabase/auth'

const SEO_WRITE_ROLES = ['admin', 'seo_agent']

export async function requireSeoUser() {
  const profile = await getCurrentProfile()
  if (!profile) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  if (!SEO_WRITE_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  }
  const supabase = await createClient()
  return { error: null, profile, supabase } as const
}
