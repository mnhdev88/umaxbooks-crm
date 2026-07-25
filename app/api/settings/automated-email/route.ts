import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { AUTOMATED_EMAIL_KEY } from '@/lib/automated-email'

// Admin-only read/write of the automated-email kill switch (app_settings.automated_email_enabled).
// app_settings has no client policy for this key, so both sides go through the
// service client here, gated on the caller's admin role.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { error: null }
}

/** Env override beats the DB row — mirrors automatedEmailEnabled(). */
const envForcedOff = () => String(process.env.AUTOMATED_EMAIL ?? '').trim().toLowerCase() === 'off'

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()

  const [{ data }, { count }] = await Promise.all([
    service.from('app_settings').select('value').eq('key', AUTOMATED_EMAIL_KEY).maybeSingle(),
    // Emails already queued by hand — these sit untouched while the switch is off and
    // go out on the next cron tick once it's back on. Surfaced so nobody is surprised.
    service.from('email_sends').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
  ])

  // Key absent = enabled, same default the server-side check uses.
  const stored = data ? ['true', '1', 'on', 'yes'].includes(String(data.value).trim().toLowerCase()) : true

  return NextResponse.json({
    enabled: stored && !envForcedOff(),
    envForcedOff: envForcedOff(),
    queued: count ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be true or false.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('app_settings')
    .upsert({ key: AUTOMATED_EMAIL_KEY, value: String(body.enabled) }, { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ enabled: body.enabled && !envForcedOff(), envForcedOff: envForcedOff() })
}
