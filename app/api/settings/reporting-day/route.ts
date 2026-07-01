import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DEFAULT_REPORT_TZ, DEFAULT_DAY_START_HOUR } from '@/lib/reporting-day'

// Admin-only read/write of the business reporting-day config: the timezone and
// the hour each reporting day starts (so daily performance doesn't reset at
// server midnight, mid-shift). Stored in app_settings; writes via service client.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { error: null }
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()
  const { data } = await service
    .from('app_settings').select('key, value')
    .in('key', ['report_timezone', 'report_day_start_hour'])
  const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]))
  return NextResponse.json({
    timezone: map['report_timezone'] || DEFAULT_REPORT_TZ,
    dayStartHour: Number(map['report_day_start_hour'] ?? DEFAULT_DAY_START_HOUR),
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const timezone = String(body?.timezone ?? '').trim()
  const dayStartHour = Math.trunc(Number(body?.dayStartHour))

  // Validate the timezone against the Intl database.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return NextResponse.json({ error: 'Invalid timezone.' }, { status: 400 })
  }
  if (!Number.isInteger(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
    return NextResponse.json({ error: 'Day start hour must be a whole number 0–23.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('app_settings')
    .upsert([
      { key: 'report_timezone', value: timezone },
      { key: 'report_day_start_hour', value: String(dayStartHour) },
    ], { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ timezone, dayStartHour })
}
