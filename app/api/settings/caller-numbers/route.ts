import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getReportDayConfig } from '@/lib/report-config'
import { reportingDate, reportingDayWindow } from '@/lib/reporting-day'
import { toE164US } from '@/lib/voice/twilio'

// Admin-only CRUD for the outbound caller-ID pool (caller_numbers), plus the
// per-number health figures the Settings card renders. Writes go through the
// service client behind an explicit admin check, matching the other settings
// routes. See supabase/migrations/091_caller_number_pool.sql.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { error: null }
}

/** Validate + normalise a submitted number to E.164, or return null if unusable. */
function normalizeNumber(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const e164 = toE164US(raw)
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null
}

function parseCap(raw: unknown, fallback = 50): number | null {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Math.trunc(Number(raw))
  return Number.isFinite(n) && n >= 1 && n <= 500 ? n : null
}

export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const service = createServiceClient()

  const { data: numbers, error: dbError } = await service
    .from('caller_numbers')
    .select('*')
    .order('created_at')
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  // Calls placed today per number, on the same reporting-day boundary the picker
  // enforces the cap against — so the UI never disagrees with the dialer.
  const cfg = await getReportDayConfig(service)
  const { fromISO, toISO } = reportingDayWindow(reportingDate(new Date(), cfg), cfg)

  const { data: todayRows } = await service
    .from('voice_calls')
    .select('from_number')
    .eq('provider', 'twilio')
    .gte('created_at', fromISO)
    .lt('created_at', toISO)
    .not('from_number', 'is', null)

  const usedToday: Record<string, number> = {}
  for (const r of (todayRows || []) as { from_number: string }[]) {
    usedToday[r.from_number] = (usedToday[r.from_number] || 0) + 1
  }

  // 30-day health, aggregated server-side (see the function's comment re: row cap).
  const { data: healthRows } = await service.rpc('caller_number_health', { p_days: 30 })
  const health: Record<string, unknown> = {}
  for (const h of (healthRows || []) as { from_number: string }[]) {
    health[h.from_number] = h
  }

  return NextResponse.json({
    numbers: numbers || [],
    usedToday,
    health,
    envFallback: process.env.TWILIO_CALLER_ID || null,
  })
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))

  const phone_number = normalizeNumber(body?.phone_number)
  if (!phone_number) {
    return NextResponse.json({ error: 'Enter a valid phone number in E.164 form, e.g. +19086395666.' }, { status: 400 })
  }

  const daily_cap = parseCap(body?.daily_cap)
  if (daily_cap === null) {
    return NextResponse.json({ error: 'Daily cap must be a whole number between 1 and 500.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('caller_numbers')
    .insert({
      phone_number,
      label: typeof body?.label === 'string' ? body.label.trim() || null : null,
      daily_cap,
      registered: body?.registered === true,
      notes: typeof body?.notes === 'string' ? body.notes.trim() || null : null,
    })
    .select()
    .single()

  if (dbError) {
    const msg = dbError.code === '23505' ? 'That number is already in the pool.' : dbError.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ number: data })
}

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('label' in body)      patch.label = typeof body.label === 'string' ? body.label.trim() || null : null
  if ('notes' in body)      patch.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
  if ('is_active' in body)  patch.is_active = body.is_active === true
  if ('registered' in body) patch.registered = body.registered === true
  if ('daily_cap' in body) {
    const cap = parseCap(body.daily_cap, NaN)
    if (cap === null || !Number.isFinite(cap)) {
      return NextResponse.json({ error: 'Daily cap must be a whole number between 1 and 500.' }, { status: 400 })
    }
    patch.daily_cap = cap
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const service = createServiceClient()
  const { data, error: dbError } = await service
    .from('caller_numbers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 400 })
  return NextResponse.json({ number: data })
}

export async function DELETE(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 })

  // Rows in voice_calls keep from_number as plain text, so past calls stay
  // attributable after a number is removed from the pool.
  const service = createServiceClient()
  const { error: dbError } = await service.from('caller_numbers').delete().eq('id', id)
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
