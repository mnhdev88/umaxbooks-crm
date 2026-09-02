import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/supabase/auth'

/**
 * Who may read and write the call settings behind Settings → Calls.
 *
 * WHY THIS EXISTS: those cards (caller number pool, calling window, daily call
 * target, team ringtone) are team-wide controls, not personal preferences — one edit
 * changes the dialer for everybody. Supervisors only, therefore: admins and sales
 * managers. A sales_agent dials with these settings but does not set them.
 *
 * The legacy 'agent' role is absent even though Reports treats it as privileged
 * (see app/api/reports/call-performance): no profile carries it today, and reading
 * "admin and sales manager" literally is the safer default for a write gate. Add it
 * here if that role is ever revived as an admin equivalent.
 *
 * NOTE this is a shared *write* gate, not just a read one: anyone in this list can
 * change a daily cap, move the calling window, or remove a number from the pool, and
 * the change applies to everyone's dialer. The routes behind it write with the service
 * client (app_settings and caller_numbers have no client write policy), so this check
 * is the only thing standing in front of those tables — RLS will not catch a mistake
 * here.
 */
export const CALL_SETTINGS_ROLES = ['admin', 'sales_manager'] as const

/**
 * Guard for the Settings → Calls API routes. Returns `{ error }` to return directly
 * when the caller is not allowed, mirroring the requireAdmin() helpers it replaced.
 */
export async function requireCallSettingsAccess(): Promise<{ error: NextResponse | null }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!CALL_SETTINGS_ROLES.includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { error: null }
}
