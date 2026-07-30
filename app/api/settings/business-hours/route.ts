import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DEFAULT_BUSINESS_HOURS } from '@/lib/business-hours'
import { DEFAULT_REPORT_TZ } from '@/lib/reporting-day'

// Admin-only read/write of the office's working hours: when a caller reaching one of
// our inbound lines gets a live ring versus the after-hours voicemail greeting (098).
// Stored in app_settings; writes go through the service client.
//
// The timezone IS settable here (099). It was previously borrowed from the Reporting
// Day card's report_timezone, until the two had to diverge: reporting stays anchored to
// Asia/Kolkata so a shift crossing IST midnight stays in one day, while the phones are
// staffed against US Eastern hours. Saving here writes business_timezone only and
// leaves report_timezone alone, so the reporting boundary can't be moved by accident.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { error: null }
}

const HHMM = /^(\d{1,2}):(\d{2})$/

function validHM(s: string): boolean {
  const m = HHMM.exec(s)
  if (!m) return false
  return Number(m[1]) <= 23 && Number(m[2]) <= 59
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()
  const { data } = await service
    .from('app_settings').select('key, value')
    .in('key', [
      'business_open',
      'business_close',
      'business_days',
      'business_timezone',
      'report_timezone',
    ])
  const map = Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

  return NextResponse.json({
    open: map['business_open'] || DEFAULT_BUSINESS_HOURS.open,
    close: map['business_close'] || DEFAULT_BUSINESS_HOURS.close,
    days: (map['business_days'] || DEFAULT_BUSINESS_HOURS.days.join(','))
      .split(',')
      .map((d: string) => Number(d.trim()))
      .filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7),
    // Same fallback chain as readBusinessHours, so the card shows the zone the
    // router will actually use rather than the one that happens to be stored.
    timezone: map['business_timezone'] || map['report_timezone'] || DEFAULT_REPORT_TZ,
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const open = String(body?.open ?? '').trim()
  const close = String(body?.close ?? '').trim()
  const timezone = String(body?.timezone ?? '').trim()
  const days: number[] = Array.isArray(body?.days)
    ? Array.from(
        new Set(
          (body.days as unknown[])
            .map((d) => Math.trunc(Number(d)))
            .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
        )
      ).sort((a, b) => a - b)
    : []

  if (!validHM(open) || !validHM(close)) {
    return NextResponse.json({ error: 'Times must be in HH:MM 24-hour format.' }, { status: 400 })
  }
  // Rejected rather than silently normalised: a close before the open is far more
  // likely to be a typo than a deliberate overnight shift, and getting it wrong
  // sends every daytime caller to voicemail.
  const toMin = (s: string) => { const m = HHMM.exec(s)!; return Number(m[1]) * 60 + Number(m[2]) }
  if (toMin(close) <= toMin(open)) {
    return NextResponse.json({ error: 'Closing time must be after the opening time.' }, { status: 400 })
  }
  if (!days.length) {
    return NextResponse.json({ error: 'Pick at least one working day.' }, { status: 400 })
  }
  // Validate against the Intl database, as the Reporting Day route does. A zone the
  // server can't resolve would make isOpenNow fail open and ring dead phones all night.
  if (!timezone) {
    return NextResponse.json({ error: 'Pick a timezone for the working hours.' }, { status: 400 })
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return NextResponse.json({ error: 'Invalid timezone.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service
    .from('app_settings')
    .upsert([
      { key: 'business_open', value: open },
      { key: 'business_close', value: close },
      { key: 'business_days', value: days.join(',') },
      // business_timezone only — report_timezone stays where the Reporting Day card
      // put it, so saving working hours can't shift the reporting day boundary.
      { key: 'business_timezone', value: timezone },
    ], { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ open, close, days, timezone })
}
