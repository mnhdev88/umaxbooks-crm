import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCallSettingsAccess } from '@/lib/settings-access'
import { RINGTONE_KEY, parseRingtoneEnabled } from '@/lib/voice/ringtone-setting'

/**
 * Org-wide inbound-call ringtone switch (app_settings.dialer_ringtone_enabled).
 *
 * GET is open to any signed-in user, unlike the other settings routes: the dialer runs
 * in every agent's browser and has to know whether to make a sound, and those agents
 * can't reach the admin-only Settings page. Writing stays admin-only.
 *
 * app_settings has no client-side policy for this key, so both sides go through the
 * service client, gated on the caller's role here.
 */

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const { data, error } = await service
    .from('app_settings')
    .select('value')
    .eq('key', RINGTONE_KEY)
    .maybeSingle()

  // A failed read must fall back to silent, not to ringing: the dialer polls this on
  // every page load and a transient error shouldn't hand the office an unexpected tone.
  if (error) {
    console.error('[settings/ringtone] read failed', error.message)
    return NextResponse.json({ enabled: false })
  }

  return NextResponse.json({ enabled: parseRingtoneEnabled(data?.value) })
}

export async function POST(req: NextRequest) {
  // Sales staff, not just admins — see lib/settings-access.ts.
  const { error: denied } = await requireCallSettingsAccess()
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true or false.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error } = await service
    .from('app_settings')
    .upsert({ key: RINGTONE_KEY, value: String(body.enabled) }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ enabled: body.enabled })
}
