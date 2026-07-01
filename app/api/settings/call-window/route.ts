import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Admin-only read/write of the leads calling window (app_settings.call_window_start
// / call_window_end), used by the Leads "Call-ready first" sort and the per-row
// call-window badge. Writes go through the service client, gated on admin role.

const DEFAULT_START = '09:30'
const DEFAULT_END   = '20:00'

// US TCPA telemarketing law forbids calls outside 8am–9pm called-party local time.
const LEGAL_MIN = 8 * 60        // 08:00
const LEGAL_MAX = 21 * 60       // 21:00

function parseHM(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

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
  const { data } = await service.from('app_settings').select('key, value')
    .in('key', ['call_window_start', 'call_window_end'])
  const map = Object.fromEntries((data || []).map(r => [r.key, r.value]))
  return NextResponse.json({
    start: map['call_window_start'] || DEFAULT_START,
    end:   map['call_window_end']   || DEFAULT_END,
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const startM = parseHM(body?.start)
  const endM   = parseHM(body?.end)
  if (startM === null || endM === null) {
    return NextResponse.json({ error: 'Use 24-hour HH:MM times.' }, { status: 400 })
  }
  if (startM >= endM) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }
  if (startM < LEGAL_MIN || endM > LEGAL_MAX) {
    return NextResponse.json({ error: 'Window must stay within 08:00–21:00 (US TCPA calling hours).' }, { status: 400 })
  }

  const service = createServiceClient()
  const { error: dbError } = await service.from('app_settings').upsert([
    { key: 'call_window_start', value: body.start.trim() },
    { key: 'call_window_end',   value: body.end.trim() },
  ], { onConflict: 'key' })
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ start: body.start.trim(), end: body.end.trim() })
}
